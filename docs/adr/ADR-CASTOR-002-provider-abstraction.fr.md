> [🇬🇧 English](ADR-CASTOR-002-provider-abstraction.md) · 🇫🇷 **Français**

# ADR-CASTOR-002 — Abstraction de provider (une interface `Provider` unique pour Docker / Swarm / Kubernetes)

- **Statut :** Accepté
- **Date :** 2026-06-02
- **Décideurs :** Architecte système (Castor)
- **Périmètre :** éléments de plan **D3** (abstraction multi-orchestrateur) et **D5** (périmètre Kubernetes V1)
- **Remplace / affine :** `PLAN-ORCHESTRATION-CASTOR.md` §3 (« Provider abstraction »), §2 lignes D3/D5
- **Voir aussi :** ADR-CASTOR-001 (transport & scalabilité), ADR-CASTOR-003 (stack serveur + BD)

---

## 1. Contexte

Castor doit présenter Docker, Docker Swarm et Kubernetes sous **une seule UX cohérente** (le
logo et le positionnement promettent les trois orchestrateurs en V1). Le backend a donc besoin
d'une **couture unique et stable** à laquelle la couche API HTTP/WS s'adresse, quel que soit le
moteur situé derrière. Sans cette couture, l'API et l'UI React se ramifieraient sur le type
d'orchestrateur partout — exactement la divergence que nous voulons éviter.

Deux contraintes fortes issues du cadrage verrouillé :

1. **Capacités asymétriques.** Docker est en **lecture + écriture complètes**. Swarm et Kubernetes
   sont en **lecture seule en V1**. L'abstraction doit permettre à l'API et à l'UI de savoir —
   *de manière déclarative, avant tout appel* — quelles actions un provider donné prend en charge,
   afin que l'UI puisse griser les boutons d'écriture au lieu de laisser l'utilisateur cliquer et
   obtenir une erreur à l'exécution.

2. **Le multi-hôte V2 arrive mais N'EST PAS construit maintenant.** V1 = un conteneur Castor qui
   dialogue avec le socket Docker **local** (`/var/run/docker.sock`) et un **kubeconfig monté**.
   L'interface doit être façonnée pour qu'un futur agent Go (hôte distant) soit *juste une autre
   implémentation de `Provider`* derrière la même couture — aucune refonte de l'API/UI lorsque les
   agents arriveront.

### Options envisagées

| Option | Résumé | Verdict |
|---|---|---|
| **A. Trois backends séparés** (DockerService / SwarmService / K8sService), l'API se ramifie par type | Aucune couture partagée ; l'API & l'UI dupliquent la logique 3× ; gestion des capacités ad hoc | ❌ Rejetée — viole le principe « une seule UX cohérente », coût de divergence élevé |
| **B. Une interface `Provider`, capacités via sondage à l'exécution** (tenter l'appel, intercepter « non implémenté ») | Couture unique, mais l'UI ne peut pas savoir à l'avance quoi griser ; les utilisateurs rencontrent des erreurs | ❌ Rejetée — mauvaise UX, c'est l'anti-pattern explicite que nous voulons éliminer |
| **C. Une interface `Provider` + bitset `Capability` déclaratif** (cet ADR) | Couture unique ; méthodes de lecture toujours présentes ; les mutations renvoient `ErrUnsupported` ; capacités interrogeables avant tout appel | ✅ **Choisie** |

---

## 2. Décision

**Une interface Go commune `Provider`** dans le package `internal/provider`, implémentée par trois
packages : `internal/provider/docker`, `internal/provider/swarm`, `internal/provider/kube`.

- Tous les providers implémentent la **surface de lecture** (`ListWorkloads`, `InspectWorkload`,
  `Logs`, `Stats`) et une surface de métadonnées (`Kind`, `ID`, `Capabilities`, `Ping`, `Close`).
- Tous les providers exposent également la **surface mutante** (`Start`, `Stop`, `Restart`,
  `Remove`, `Exec`) dans l'interface, mais les **providers en lecture seule renvoient
  `provider.ErrUnsupported`** depuis ces méthodes. Ils le font gratuitement en embarquant un helper
  partagé `ReadOnlyMutations`.
- Un provider déclare ce qu'il sait faire via un **bitset `Capability`** renvoyé par
  `Capabilities()`. L'API sérialise ces drapeaux vers l'UI afin que les affordances d'écriture
  soient grisées *avant* que l'utilisateur ne clique.
- Une structure **`Workload`** normalisée unifie un conteneur Docker, une service-task Swarm et un
  pod K8s en une seule forme que l'API et l'UI consomment uniformément.

### 2.1 Matrice de capacités V1 (verrouillée)

| Provider | Kind | Lecture (List/Inspect/Logs/Stats) | Start/Stop/Restart/Remove | Exec | Drapeaux de capacité positionnés |
|---|---|---|---|---|---|
| Docker | `KindDocker` | ✅ | ✅ | ✅ | `CapList \| CapInspect \| CapLogs \| CapStats \| CapStart \| CapStop \| CapRestart \| CapRemove \| CapExec \| CapEvents \| CapImages \| CapNetworks \| CapVolumes` |
| Swarm | `KindSwarm` | ✅ (services/nodes/tasks) | ❌ `ErrUnsupported` | ❌ `ErrUnsupported` | `CapList \| CapInspect \| CapLogs \| CapStats \| CapReadOnly` |
| Kubernetes | `KindKubernetes` | ✅ (pods/deployments/nodes) | ❌ `ErrUnsupported` | ❌ `ErrUnsupported` | `CapList \| CapInspect \| CapLogs \| CapReadOnly` (pas de `CapStats` en V1 — voir §2.5) |

> `CapLogs` est positionné pour Swarm/K8s car les deux moteurs diffusent les logs en lecture seule
> (daemon Docker pour les tasks Swarm ; sous-ressource `pods/log` pour K8s). Swarm positionne
> `CapStats` (stats par task via le daemon Docker) ; **K8s ne positionne PAS `CapStats` en V1**
> car cela requiert metrics-server et sort du périmètre lecture-seule-via-core-API (D5).

### 2.2 L'interface `Provider` (canonique — les implémenteurs implémentent exactement ceci)

Package : `internal/provider`

```go
package provider

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrUnsupported is returned by mutating methods on read-only providers
// (Swarm, Kubernetes in V1). The API maps it to HTTP 405 Method Not Allowed.
var ErrUnsupported = errors.New("provider: operation not supported by this orchestrator")

// ErrNotFound is returned when a workload id is unknown to the provider.
// The API maps it to HTTP 404.
var ErrNotFound = errors.New("provider: workload not found")

// OrchestratorKind identifies the engine behind a Provider.
type OrchestratorKind string

const (
	KindDocker     OrchestratorKind = "docker"
	KindSwarm      OrchestratorKind = "swarm"
	KindKubernetes OrchestratorKind = "kubernetes"
)

// Provider is the single seam the API/UI layer talks to, regardless of orchestrator.
// Read methods MUST be implemented by every provider. Mutating methods MUST return
// ErrUnsupported on read-only providers (use the ReadOnlyMutations embeddable helper).
type Provider interface {
	// --- identity & capability (cheap, no remote call except Ping) ---

	// Kind returns the orchestrator family (docker/swarm/kubernetes).
	Kind() OrchestratorKind

	// ID is the stable provider instance id. In V1 this is the local provider
	// (e.g. "local-docker"); in V2 it is the agent/host id. Workload.ProviderID
	// always equals this.
	ID() string

	// Capabilities returns the declarative bitset the UI uses to grey out actions.
	Capabilities() Capability

	// Ping verifies connectivity to the underlying engine. Used for health.
	Ping(ctx context.Context) error

	// Close releases the underlying client/connection.
	Close() error

	// --- read surface (ALL providers implement) ---

	// ListWorkloads returns the normalized workloads visible to this provider.
	ListWorkloads(ctx context.Context, opts ListOptions) ([]Workload, error)

	// InspectWorkload returns one workload plus its raw, engine-specific JSON
	// (Raw is opaque to the API; the UI shows it in an "inspect" panel).
	InspectWorkload(ctx context.Context, id string) (*WorkloadDetail, error)

	// Logs streams logs for a workload. The caller closes the returned ReadCloser
	// to stop the stream. Honors LogOptions (Follow, Tail, Since, Timestamps).
	Logs(ctx context.Context, id string, opts LogOptions) (io.ReadCloser, error)

	// Stats streams resource samples for a workload until ctx is cancelled or the
	// returned channel is closed. Providers without stats set !CapStats and return
	// ErrUnsupported here (V1: Kubernetes).
	Stats(ctx context.Context, id string) (<-chan StatSample, error)

	// --- mutating surface (read-only providers return ErrUnsupported) ---

	Start(ctx context.Context, id string) error
	Stop(ctx context.Context, id string, timeout *time.Duration) error
	Restart(ctx context.Context, id string, timeout *time.Duration) error
	Remove(ctx context.Context, id string, opts RemoveOptions) error

	// Exec runs an interactive command inside a workload. Returns a bidirectional
	// stream (stdin/stdout/stderr multiplexed). Read-only providers return ErrUnsupported.
	Exec(ctx context.Context, id string, opts ExecOptions) (ExecStream, error)
}
```

### 2.3 Le bitset `Capability`

```go
package provider

// Capability is a bitset of operations a Provider supports. The API serializes the
// active flags to the UI (as a string array) so write affordances are greyed out
// BEFORE the user clicks — never "click then 405".
type Capability uint32

const (
	CapList     Capability = 1 << iota // ListWorkloads
	CapInspect                         // InspectWorkload
	CapLogs                            // Logs (stream)
	CapStats                           // Stats (stream)
	CapStart                           // Start
	CapStop                            // Stop
	CapRestart                         // Restart
	CapRemove                          // Remove
	CapExec                            // Exec
	CapEvents                          // engine event stream (Docker V1 only)
	CapImages                          // image management (Docker V1 only)
	CapNetworks                        // network management (Docker V1 only)
	CapVolumes                         // volume management (Docker V1 only)
	CapReadOnly                        // marker: provider performs NO mutations
)

// Has reports whether all bits in c are set.
func (c Capability) Has(want Capability) bool { return c&want == want }

// Strings returns the active capabilities as stable lowercase tokens for the API/UI
// (e.g. ["list","inspect","logs","stats"]). Order is deterministic.
func (c Capability) Strings() []string { /* builder: map each set bit to its token */ }
```

### 2.4 Le type `Workload` normalisé

```go
package provider

import "time"

// WorkloadState is the normalized lifecycle state across orchestrators.
type WorkloadState string

const (
	StateRunning    WorkloadState = "running"
	StateStopped    WorkloadState = "stopped"    // docker: exited; k8s: Succeeded/Failed terminal
	StatePaused     WorkloadState = "paused"     // docker only
	StateRestarting WorkloadState = "restarting"
	StatePending    WorkloadState = "pending"    // k8s Pending; swarm task allocating
	StateUnknown    WorkloadState = "unknown"
)

// Port is a normalized published/exposed port.
type Port struct {
	Private  uint16 `json:"private"`            // container/pod port
	Public   uint16 `json:"public,omitempty"`   // host/published port (0 if none)
	Protocol string `json:"protocol"`           // "tcp" | "udp" | "sctp"
}

// Workload is the unified, orchestrator-agnostic shape the API and UI consume.
// One Workload == one Docker container | one Swarm service-task | one K8s pod.
type Workload struct {
	// ID is the provider-native id: docker container id, swarm task id, or
	// "<namespace>/<podName>" for K8s. Unique within (ProviderID).
	ID string `json:"id"`

	// Name is the human-friendly name (container name / service.task / pod name).
	Name string `json:"name"`

	// Kind is the orchestrator family this workload came from.
	Kind OrchestratorKind `json:"kind"`

	// ProviderID is the provider instance that owns this workload. Equals Provider.ID().
	// V1: the local provider. V2: the agent/host id. (Multi-host-ready, no schema change.)
	ProviderID string `json:"providerId"`

	// Node is the physical placement: docker -> hostname; swarm -> node id/hostname;
	// k8s -> spec.nodeName. Empty if unscheduled/pending.
	Node string `json:"node,omitempty"`

	// State is the normalized lifecycle state.
	State WorkloadState `json:"state"`

	// StateRaw is the engine-native state string (e.g. "Exited (0) 3 min ago",
	// "CrashLoopBackOff", "Running"), shown verbatim in the UI for fidelity.
	StateRaw string `json:"stateRaw,omitempty"`

	// Image is the container image reference (docker image; swarm task spec image;
	// k8s primary/first container image).
	Image string `json:"image"`

	// Ports are the normalized published/exposed ports.
	Ports []Port `json:"ports,omitempty"`

	// Labels are the merged labels/annotations (docker labels; swarm labels;
	// k8s labels). Used by the UI for grouping/filtering (stack, project, etc.).
	Labels map[string]string `json:"labels,omitempty"`

	// CreatedAt is the creation timestamp (UTC).
	CreatedAt time.Time `json:"createdAt"`

	// Group is an optional logical grouping key the UI uses for the "stack/app" view:
	// docker -> com.docker.compose.project label; swarm -> service name;
	// k8s -> owner (Deployment/StatefulSet) name. Empty if none.
	Group string `json:"group,omitempty"`

	// Protected marks system/Castor-own workloads that must NOT be removed by accident.
	// The API rejects Remove on a Protected workload (defense-in-depth with RBAC).
	Protected bool `json:"protected"`
}

// WorkloadDetail is the full inspect payload: the normalized header + opaque raw JSON.
type WorkloadDetail struct {
	Workload
	// Raw is the engine-specific inspect document (docker ContainerJSON,
	// swarm Task, or k8s Pod) marshalled to JSON. Opaque to the API.
	Raw json.RawMessage `json:"raw"`
}
```

### 2.5 Types de support pour les options & les flux

```go
package provider

import (
	"context"
	"io"
	"time"
)

// ListOptions filters/paginates ListWorkloads. All fields optional.
type ListOptions struct {
	All           bool              // include stopped/terminal workloads (docker All=true)
	LabelSelector map[string]string // label/annotation equality filters
	Namespace     string            // k8s only; "" = all namespaces the kubeconfig can read
}

// LogOptions controls Logs streaming.
type LogOptions struct {
	Follow     bool
	Tail       int    // 0 = all; N = last N lines
	Since      time.Time
	Timestamps bool
	Container  string // k8s: which container in the pod ("" = first/default)
}

// RemoveOptions controls Remove (Docker only in V1).
type RemoveOptions struct {
	Force         bool
	RemoveVolumes bool
}

// ExecOptions controls Exec (Docker only in V1).
type ExecOptions struct {
	Cmd        []string
	Tty        bool
	Env        []string
	WorkingDir string
}

// ExecStream is the bidirectional exec attachment.
type ExecStream interface {
	io.ReadWriteCloser
	// Resize updates the TTY size (rows, cols).
	Resize(ctx context.Context, rows, cols uint16) error
	// ExitCode blocks until the command exits and returns its code (-1 if unknown).
	ExitCode(ctx context.Context) (int, error)
}

// StatSample is one normalized resource sample emitted by Stats.
type StatSample struct {
	Timestamp     time.Time `json:"timestamp"`
	CPUPercent    float64   `json:"cpuPercent"`           // 0..(100*nCPU)
	MemUsageBytes uint64    `json:"memUsageBytes"`
	MemLimitBytes uint64    `json:"memLimitBytes"`        // 0 if unlimited/unknown
	NetRxBytes    uint64    `json:"netRxBytes"`
	NetTxBytes    uint64    `json:"netTxBytes"`
	BlkReadBytes  uint64    `json:"blkReadBytes"`
	BlkWriteBytes uint64    `json:"blkWriteBytes"`
}
```

### 2.6 `ReadOnlyMutations` — helper partagé « renvoyer `ErrUnsupported` »

Les providers en lecture seule (`swarm`, `kube` en V1) embarquent ceci afin de **ne pas**
réimplémenter les cinq méthodes mutantes. Cela garantit que chaque provider en lecture seule échoue
de manière uniforme et que la logique de grisage de l'UI ainsi que le mapping 405 de l'API restent
cohérents.

```go
package provider

import (
	"context"
	"time"
)

// ReadOnlyMutations provides the mutating-method set, all returning ErrUnsupported.
// Embed it in any read-only Provider implementation (Swarm, Kubernetes in V1).
type ReadOnlyMutations struct{}

func (ReadOnlyMutations) Start(context.Context, string) error                  { return ErrUnsupported }
func (ReadOnlyMutations) Stop(context.Context, string, *time.Duration) error   { return ErrUnsupported }
func (ReadOnlyMutations) Restart(context.Context, string, *time.Duration) error{ return ErrUnsupported }
func (ReadOnlyMutations) Remove(context.Context, string, RemoveOptions) error  { return ErrUnsupported }
func (ReadOnlyMutations) Exec(context.Context, string, ExecOptions) (ExecStream, error) {
	return nil, ErrUnsupported
}
```

> **Note sur `Stats` pour K8s :** `Stats` fait partie de la surface de *lecture*, il ne peut donc
> pas résider dans `ReadOnlyMutations`. Le provider K8s implémente `Stats` sous la forme d'un
> `return nil, ErrUnsupported` d'une seule ligne et ne positionne **pas** `CapStats`. Swarm, lui,
> implémente bel et bien `Stats` (par task, via le daemon Docker) et positionne `CapStats`.

### 2.7 Registry & compatibilité V2

```go
package provider

// Registry holds the active providers, keyed by Provider.ID(). The API resolves a
// workload to its owning provider via Workload.ProviderID. In V1 the registry has
// exactly the providers configured locally (docker + optionally swarm + optionally
// kube). In V2 each enrolled agent registers as an additional Provider with the SAME
// interface — no API/UI change.
type Registry struct{ /* map[string]Provider, RWMutex */ }

func (r *Registry) Register(p Provider)            { /* ... */ }
func (r *Registry) Get(id string) (Provider, bool) { /* ... */ }
func (r *Registry) List() []Provider               { /* ... */ }
```

C'est l'unique choix de conception qui fait du multi-hôte un **ajout V2, pas une réécriture V2** :
les agents sont des providers, la couture ne bouge jamais.

---

## 3. Notes d'implémentation des providers (par package)

### `internal/provider/docker` — lecture+écriture COMPLÈTES

- **Module :** `github.com/docker/docker/client`
- **Client :** `client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())`.
  En V1, on se connecte au **socket unix monté** `/var/run/docker.sock` (par défaut via `FromEnv` /
  `DOCKER_HOST`). La négociation de version d'API est obligatoire (le daemon peut être plus ancien
  ou plus récent que le SDK).
- **Packages de types :**
  - `github.com/docker/docker/api/types/container` — `ContainerList`, `ListOptions`, `StartOptions`, `StopOptions`, `RemoveOptions`, `LogsOptions`, `ExecOptions`, `Stats`
  - `github.com/docker/docker/api/types/image` — opérations sur les images (`CapImages`)
  - `github.com/docker/docker/api/types/network` — opérations réseau (`CapNetworks`)
  - `github.com/docker/docker/api/types/volume` — opérations sur les volumes (`CapVolumes`)
  - `github.com/docker/docker/api/types/filters` — filtres de listing
  - `github.com/docker/docker/api/types/events` — flux d'événements du moteur (`CapEvents`)
- **Mapping :** id de conteneur→`Workload.ID` ; `Names[0]`→`Name` ; `State`/`Status`→
  `State`/`StateRaw` ; `Image` ; `Ports`→`[]Port` ; `Labels` (dont
  `com.docker.compose.project`→`Group`) ; `Created`(unix)→`CreatedAt`. `Node` = hostname du daemon.
- **Stats :** `ContainerStats(ctx, id, true)` → décoder le JSON en streaming → émettre `StatSample`
  (calculer le CPU% à partir des deltas cpu/precpu).
- **Exec :** `ContainerExecCreate` + `ContainerExecAttach` → envelopper `HijackedResponse` en `ExecStream`.
- **Protected :** marquer le conteneur propre à Castor (env `CASTOR_SELF_CONTAINER_ID`) et tout
  conteneur labellisé `castor.protected=true` → `Workload.Protected=true`.

### `internal/provider/swarm` — LECTURE SEULE

- **Module :** même SDK Docker (`github.com/docker/docker/client`) ; Swarm utilise la même API daemon.
- **Types :** `github.com/docker/docker/api/types/swarm` — `Service`, `Task`, `Node`.
- **Embarque `provider.ReadOnlyMutations`.**
- **Mapping :** un `Workload` **par task** (`ServiceList` + `TaskList` + `NodeList`) :
  id de task→`ID` ; `<serviceName>.<slot>`→`Name` ; nom de service→`Group` ; `Task.NodeID`→résoudre
  vers le hostname du node→`Node` ; `Task.Status.State`→`State`/`StateRaw` ;
  `Task.Spec.ContainerSpec.Image`→`Image`. Positionne `CapList|CapInspect|CapLogs|CapStats|CapReadOnly`.
- **Logs/Stats :** via le daemon Docker pour le conteneur sous-jacent de la task (`ServiceLogs` /
  stats du conteneur par task).

### `internal/provider/kube` — LECTURE SEULE (périmètre D5)

- **Modules :**
  - `k8s.io/client-go/kubernetes` — `Clientset` typé (`kubernetes.NewForConfig(restCfg)`)
  - `k8s.io/client-go/tools/clientcmd` — charger le **kubeconfig monté** :
    `clientcmd.NewNonInteractiveDeferredLoadingClientConfig(&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}, &clientcmd.ConfigOverrides{}).ClientConfig()`
    (ou `clientcmd.BuildConfigFromFlags("", kubeconfigPath)`). En V1, on honore `KUBECONFIG` /
    `/root/.kube/config` monté dans le conteneur Castor.
  - `k8s.io/api/core/v1` — `Pod`, `PodList`, `Node` (alias `corev1`)
  - `k8s.io/apimachinery/pkg/apis/meta/v1` — `ListOptions`, `ObjectMeta` (alias `metav1`)
- **Embarque `provider.ReadOnlyMutations`.**
- **Mapping :** un `Workload` **par pod** (`CoreV1().Pods(ns).List`) :
  `"<namespace>/<name>"`→`ID` ; nom du pod→`Name` ; `Spec.NodeName`→`Node` ; `Status.Phase`(+
  statuts des conteneurs, par ex. `CrashLoopBackOff`)→`State`/`StateRaw` ; image du premier
  conteneur→`Image` ; `Labels` du pod→`Labels` ; nom de la référence de propriétaire
  (Deployment/StatefulSet)→`Group` ; `CreationTimestamp`→`CreatedAt`. Les deployments/nodes sont
  exposés comme listes en lecture seule supplémentaires par le package kube (consommées par des
  endpoints API dédiés, non repliées dans `Workload`).
- **Logs :** `CoreV1().Pods(ns).GetLogs(...).Stream(ctx)` (honore `LogOptions.Container`).
  Positionne `CapList|CapInspect|CapLogs|CapReadOnly`.
- **Stats :** **PAS en V1.** `Stats` renvoie `ErrUnsupported`, `CapStats` non positionné
  (metrics-server est hors périmètre — à revoir en V2 en même temps que les actions d'écriture).

---

## 4. Contrat API/UI (comment la couture est consommée)

- L'API expose `GET /api/providers` → pour chaque provider : `{id, kind, capabilities:[...]}`
  (à partir de `Capability.Strings()`). **L'UI grise un bouton d'écriture si et seulement si le
  provider propriétaire ne dispose pas de la capacité correspondante** — aucun appel par tâtonnement.
- L'API mappe `provider.ErrUnsupported` → **HTTP 405**, `provider.ErrNotFound` → **404**.
- Chaque appel mutant (`Start/Stop/Restart/Remove/Exec`) est enveloppé par l'API dans le middleware
  de journal d'audit + RBAC ; une cible `Workload.Protected==true` est rejetée **avant** d'atteindre
  le provider (ceinture et bretelles avec le garde-fou propre au provider).

---

## 5. Conséquences

**Positives**
- Une seule couture : l'API et l'UI React ne se ramifient jamais sur le type d'orchestrateur pour la
  surface de workload cœur.
- Les capacités sont **déclaratives et en pré-vol** → l'UI grise les actions non prises en charge ;
  les utilisateurs ne « cliquent jamais puis 405 ». C'est un différenciateur concret face à une UX à
  erreur d'exécution.
- Les providers en lecture seule sont triviaux et uniformes (embarquent `ReadOnlyMutations`) →
  faible surface de bugs, et « Swarm/K8s sont en lecture seule en V1 » est garanti *par
  construction*, pas par discipline.
- **Le multi-hôte V2 est additif :** un agent est juste un autre `Provider` enregistré dans le
  `Registry` ; `Workload.ProviderID`/`Node` portent déjà le placement. Aucun changement d'interface
  ni d'UI.

**Négatives / compromis**
- Le plus petit dénominateur commun de `Workload` masque la richesse spécifique à chaque moteur ;
  atténué par `WorkloadDetail.Raw` (JSON opaque du moteur) pour le panneau d'inspection.
- La réutilisation par Swarm du SDK Docker couple les deux providers à une même version majeure de
  SDK — acceptable (ils ciblent la même API daemon) et signalé pour la revue de dépendances.
- `Stats` résidant sur la surface de lecture (et non dans `ReadOnlyMutations`) implique que le
  provider K8s écrit un stub `ErrUnsupported` d'une ligne ; trivial mais explicite.

**Neutres**
- Ajouter plus tard le support en écriture à Swarm/K8s = basculer les bits de capacité + implémenter
  les méthodes (retirer l'embed). Aucun changement de l'interface, du type `Workload`, ni d'aucun
  consommateur.

---

## 6. Chemins de modules de dépendances verrouillés (pour ADR-CASTOR-003 / go.mod)

| Objet | Chemin de module |
|---|---|
| SDK Docker / Swarm (client) | `github.com/docker/docker/client` |
| Types Docker (container/image/network/volume/filters/events/swarm) | `github.com/docker/docker/api/types/...` |
| Clientset typé K8s | `k8s.io/client-go/kubernetes` |
| Chargement du kubeconfig K8s | `k8s.io/client-go/tools/clientcmd` |
| Config rest K8s | `k8s.io/client-go/rest` |
| Types de l'API core K8s (Pod/Node) | `k8s.io/api/core/v1` |
| Types meta apimachinery K8s | `k8s.io/apimachinery/pkg/apis/meta/v1` |
