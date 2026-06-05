// ui/src/components/HelpPanel.tsx
//
// Reusable bilingual (EN/FR) in-app help for configuring Docker Swarm and
// Kubernetes optimally. Rendered as a wide Modal with a language toggle, richly
// structured sections, copy-to-clipboard shell commands and external doc links.
//
// No i18n library is pulled in: content is authored as parallel { en, fr }
// blocks and a small `lang` state picks the active one (defaults to EN).

import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { ActionButton } from "./ActionButton";
import { IconCopy, IconCheck, IconExternal } from "./icons";
import { toast } from "../lib/toast";

type Lang = "en" | "fr";
type Topic = "swarm" | "kubernetes";

interface HelpPanelProps {
  topic: Topic;
  open: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/* Copy-able shell command block                                       */
/* ------------------------------------------------------------------ */

function CommandBlock({ command, copyLabel }: { command: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success(copyLabel);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (insecure context / permissions).
      toast.error(copyLabel, command);
    }
  };

  return (
    <div className="help-cmd">
      <code className="help-cmd-text">{command}</code>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon help-cmd-copy"
        onClick={copy}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h3 className="help-section-title">{title}</h3>
      {children}
    </section>
  );
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="help-doclink" href={href} target="_blank" rel="noopener noreferrer">
      {label}
      <IconExternal size={13} />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Copy labels (also bilingual)                                        */
/* ------------------------------------------------------------------ */

const COPY_LABEL: Record<Lang, string> = {
  en: "Copied to clipboard",
  fr: "Copié dans le presse-papiers",
};

/* ================================================================== */
/* SWARM content                                                       */
/* ================================================================== */

function SwarmHelp({ lang }: { lang: Lang }) {
  const L = COPY_LABEL[lang];

  if (lang === "fr") {
    return (
      <>
        <Section title="Qu'est-ce que Docker Swarm ?">
          <p className="help-p">
            Swarm est l'orchestrateur natif de Docker : il fédère plusieurs hôtes Docker en un seul
            cluster et planifie des <strong>services</strong> (conteneurs répliqués) à travers eux. Plus
            simple à exploiter que Kubernetes, c'est un excellent choix pour un parc <strong>petit à
            moyen</strong> multi-hôtes lorsque vous voulez de la haute disponibilité sans la complexité
            de K8s.
          </p>
        </Section>

        <Section title="Activer Swarm sur un seul nœud">
          <p className="help-p">
            Sur l'hôte qui deviendra le manager, initialisez le cluster :
          </p>
          <CommandBlock command="docker swarm init" copyLabel={L} />
          <p className="help-p help-note">
            Sur une machine à plusieurs interfaces réseau, précisez l'adresse à publier :
          </p>
          <CommandBlock command="docker swarm init --advertise-addr <IP>" copyLabel={L} />
          <p className="help-p">
            Castor affiche alors immédiatement le nœud manager et vous permet de déployer des services.
          </p>
        </Section>

        <Section title="Ajouter des nœuds (workers / managers)">
          <p className="help-p">
            Sur le manager, récupérez la commande de jointure pour le rôle voulu :
          </p>
          <CommandBlock command="docker swarm join-token worker" copyLabel={L} />
          <CommandBlock command="docker swarm join-token manager" copyLabel={L} />
          <p className="help-p">
            Puis exécutez sur l'autre hôte la commande affichée :
          </p>
          <CommandBlock
            command="docker swarm join --token <TOKEN> <MANAGER-IP>:2377"
            copyLabel={L}
          />
        </Section>

        <Section title="Vérifier">
          <p className="help-p">Depuis un manager, les nœuds doivent apparaître Ready / Active :</p>
          <CommandBlock command="docker node ls" copyLabel={L} />
        </Section>

        <Section title="Utilisation dans Castor">
          <p className="help-p">
            Dès que Swarm est actif, la page Swarm permet de <strong>déployer</strong> un service (image,
            réplicas, ports publiés), de le <strong>scaler</strong>, de le <strong>mettre à jour</strong>{" "}
            (rolling update), de le <strong>redémarrer</strong>, de le <strong>supprimer</strong>, et de{" "}
            <strong>drainer / réactiver</strong> les nœuds.
          </p>
        </Section>

        <Section title="Bonnes pratiques (production)">
          <ul className="help-ul">
            <li>
              Utilisez un nombre <strong>impair</strong> de managers (3 ou 5) pour le quorum / la HA.
            </li>
            <li>
              Gardez les managers dédiés en drainant les charges qui s'y trouvent :
              <CommandBlock
                command="docker node update --availability drain <mgr>"
                copyLabel={L}
              />
            </li>
            <li>Utilisez des réseaux <strong>overlay</strong> pour la communication service-à-service.</li>
            <li>
              Stockez les identifiants dans des <strong>secrets Docker</strong>, jamais en variables
              d'environnement :
              <CommandBlock command="docker secret create <name> <file>" copyLabel={L} />
            </li>
            <li>Épinglez les tags d'image (évitez <code>:latest</code>).</li>
            <li>
              Définissez <code>--limit-cpu</code> / <code>--limit-memory</code> et des healthchecks.
            </li>
            <li>Exposez les services via un ingress / reverse-proxy.</li>
            <li>
              Ouvrez entre les nœuds : <code>2377/tcp</code> (gestion du cluster), <code>7946/tcp+udp</code>{" "}
              (découverte des nœuds), <code>4789/udp</code> (overlay VXLAN).
            </li>
          </ul>
        </Section>

        <Section title="Désactiver / quitter">
          <p className="help-p">Pour qu'un nœud quitte le swarm (mono-nœud inclus) :</p>
          <CommandBlock command="docker swarm leave --force" copyLabel={L} />
        </Section>

        <Section title="Documentation">
          <DocLink href="https://docs.docker.com/engine/swarm/" label="Docker Swarm — documentation officielle" />
        </Section>
      </>
    );
  }

  // English
  return (
    <>
      <Section title="What is Docker Swarm?">
        <p className="help-p">
          Swarm is Docker's native clustering and orchestration mode: it pools several Docker hosts into
          a single cluster and schedules <strong>services</strong> (replicated containers) across them.
          It is simpler to run than Kubernetes and a great fit for <strong>small-to-medium</strong>{" "}
          multi-host setups where you want high availability without the K8s learning curve.
        </p>
      </Section>

      <Section title="Enable single-node Swarm">
        <p className="help-p">On the host that will become the manager, initialise the cluster:</p>
        <CommandBlock command="docker swarm init" copyLabel={L} />
        <p className="help-p help-note">
          On a multi-NIC host, specify which address to advertise:
        </p>
        <CommandBlock command="docker swarm init --advertise-addr <IP>" copyLabel={L} />
        <p className="help-p">
          Castor then immediately shows the manager node and lets you deploy services.
        </p>
      </Section>

      <Section title="Add worker / manager nodes">
        <p className="help-p">On the manager, get the join command for the role you want:</p>
        <CommandBlock command="docker swarm join-token worker" copyLabel={L} />
        <CommandBlock command="docker swarm join-token manager" copyLabel={L} />
        <p className="help-p">Then run the printed command on the other host:</p>
        <CommandBlock
          command="docker swarm join --token <TOKEN> <MANAGER-IP>:2377"
          copyLabel={L}
        />
      </Section>

      <Section title="Verify">
        <p className="help-p">From a manager, nodes should list as Ready / Active:</p>
        <CommandBlock command="docker node ls" copyLabel={L} />
      </Section>

      <Section title="Using Castor">
        <p className="help-p">
          Once Swarm is active, the Swarm page lets you <strong>deploy</strong> a service (image,
          replicas, published ports), <strong>scale</strong> it, <strong>update</strong> it (rolling
          update), <strong>restart</strong> it, <strong>remove</strong> it, and{" "}
          <strong>drain / activate</strong> nodes.
        </p>
      </Section>

      <Section title="Best practices (production)">
        <ul className="help-ul">
          <li>
            Use an <strong>odd</strong> number of managers (3 or 5) for quorum / HA.
          </li>
          <li>
            Keep managers dedicated by draining workloads off them:
            <CommandBlock command="docker node update --availability drain <mgr>" copyLabel={L} />
          </li>
          <li>Use <strong>overlay</strong> networks for service-to-service traffic.</li>
          <li>
            Put credentials in <strong>Docker secrets</strong>, never in env vars:
            <CommandBlock command="docker secret create <name> <file>" copyLabel={L} />
          </li>
          <li>Pin image tags (avoid <code>:latest</code>).</li>
          <li>
            Set <code>--limit-cpu</code> / <code>--limit-memory</code> and healthchecks per service.
          </li>
          <li>Expose services through an ingress / reverse proxy.</li>
          <li>
            Open ports between nodes: <code>2377/tcp</code> (cluster management), <code>7946/tcp+udp</code>{" "}
            (node discovery), <code>4789/udp</code> (overlay VXLAN).
          </li>
        </ul>
      </Section>

      <Section title="Disable / leave">
        <p className="help-p">To make a node leave the swarm (single node included):</p>
        <CommandBlock command="docker swarm leave --force" copyLabel={L} />
      </Section>

      <Section title="Documentation">
        <DocLink href="https://docs.docker.com/engine/swarm/" label="Docker Swarm — official docs" />
      </Section>
    </>
  );
}

/* ================================================================== */
/* KUBERNETES content                                                  */
/* ================================================================== */

function KubernetesHelp({ lang }: { lang: Lang }) {
  const L = COPY_LABEL[lang];

  if (lang === "fr") {
    return (
      <>
        <Section title="Qu'est-ce que Kubernetes ?">
          <p className="help-p">
            Kubernetes (K8s) est un orchestrateur <strong>déclaratif</strong> à grande échelle, doté d'un
            écosystème très riche. Il est plus puissant mais a une courbe d'apprentissage plus raide que
            Swarm — privilégiez-le pour les déploiements importants ou exigeants.
          </p>
        </Section>

        <Section title="Comment Castor se connecte">
          <p className="help-p">
            Castor se connecte à un cluster <strong>existant</strong> en lecture + écriture via un
            kubeconfig monté : il <strong>ne crée pas</strong> de cluster. Deux étapes.
          </p>
        </Section>

        <Section title="Étape 1 — Disposer d'un cluster + kubeconfig">
          <p className="help-p">Options locales courantes :</p>
          <ul className="help-ul">
            <li>
              <strong>Docker Desktop</strong> : Settings → Kubernetes → « Enable Kubernetes ».
            </li>
            <li>
              <strong>k3d</strong> : <CommandBlock command="k3d cluster create castor" copyLabel={L} />
            </li>
            <li>
              <strong>kind</strong> : <CommandBlock command="kind create cluster" copyLabel={L} />
            </li>
            <li>
              <strong>minikube</strong> : <CommandBlock command="minikube start" copyLabel={L} />
            </li>
          </ul>
          <p className="help-p help-note">
            Le kubeconfig se trouve généralement dans <code>~/.kube/config</code> (Windows :{" "}
            <code>C:\Users\&lt;vous&gt;\.kube\config</code>).
          </p>
        </Section>

        <Section title="Étape 2 — Monter le kubeconfig dans Castor">
          <p className="help-p">
            Montez le fichier dans le conteneur Castor et pointez <code>CASTOR_KUBECONFIG</code> dessus.
            Ajouts à <code>docker run</code> :
          </p>
          <CommandBlock
            command="-v $HOME/.kube/config:/home/nonroot/.kube/config:ro -e CASTOR_KUBECONFIG=/home/nonroot/.kube/config"
            copyLabel={L}
          />
          <p className="help-p">Équivalent docker-compose :</p>
          <CommandBlock
            command={
              "services:\n  castor:\n    volumes:\n      - ~/.kube/config:/home/nonroot/.kube/config:ro\n    environment:\n      CASTOR_KUBECONFIG: /home/nonroot/.kube/config"
            }
            copyLabel={L}
          />
        </Section>

        <Section title="⚠️ Le piège n°1 — adresse du serveur API">
          <p className="help-p">
            L'adresse <code>server:</code> du kubeconfig doit être joignable <strong>depuis l'intérieur
            du conteneur</strong>. Une adresse <code>127.0.0.1</code> (cas fréquent avec Docker Desktop,
            k3d, kind, minikube) ne fonctionnera <strong>pas</strong> depuis le conteneur : la boucle
            locale y désigne le conteneur lui-même, pas votre hôte.
          </p>
          <p className="help-p">
            Remplacez-la par <code>host.docker.internal</code> (Docker Desktop) ou par l'IP LAN de votre
            machine, par exemple :
          </p>
          <CommandBlock
            command="server: https://host.docker.internal:6443"
            copyLabel={L}
          />
        </Section>

        <Section title="Vérifier depuis l'hôte">
          <CommandBlock command="kubectl get nodes" copyLabel={L} />
          <CommandBlock command="kubectl get pods -A" copyLabel={L} />
        </Section>

        <Section title="Utilisation dans Castor">
          <p className="help-p">
            Une fois connecté, la page Kubernetes liste les <strong>pods / deployments / nodes</strong>{" "}
            par namespace et permet de <strong>scaler</strong> les deployments, de faire un{" "}
            <strong>rollout restart</strong>, de <strong>supprimer</strong> des pods / deployments, et
            d'<strong>appliquer des manifestes YAML</strong> (server-side apply).
          </p>
        </Section>

        <Section title="Bonnes pratiques">
          <ul className="help-ul">
            <li>Isolez avec des <strong>namespaces</strong>.</li>
            <li>
              Appliquez le <strong>RBAC</strong> : un ServiceAccount au moindre privilège pour le
              kubeconfig utilisé par Castor — pas de <code>cluster-admin</code> en production.
            </li>
            <li>Définissez des <strong>requests / limits</strong> de ressources.</li>
            <li>Ajoutez des sondes <strong>readiness / liveness</strong>.</li>
            <li>Préférez les <strong>Deployments</strong> aux Pods nus.</li>
            <li>Gérez les manifestes en <strong>GitOps</strong>.</li>
            <li>Ne committez <strong>jamais</strong> de kubeconfig ni de secrets.</li>
          </ul>
        </Section>

        <Section title="Documentation">
          <DocLink href="https://kubernetes.io/docs/home/" label="Kubernetes — documentation" />
          <DocLink href="https://kubernetes.io/docs/tasks/tools/" label="Installer les outils (kubectl, clusters locaux)" />
        </Section>
      </>
    );
  }

  // English
  return (
    <>
      <Section title="What is Kubernetes?">
        <p className="help-p">
          Kubernetes (K8s) is a large-scale, <strong>declarative</strong> orchestrator with a rich
          ecosystem. It is more powerful but has a steeper learning curve than Swarm — reach for it on
          large or demanding deployments.
        </p>
      </Section>

      <Section title="How Castor connects">
        <p className="help-p">
          Castor connects to an <strong>existing</strong> cluster, read + write, through a mounted
          kubeconfig — it <strong>does not create</strong> clusters. Two steps.
        </p>
      </Section>

      <Section title="Step 1 — Have a cluster + kubeconfig">
        <p className="help-p">Common local options:</p>
        <ul className="help-ul">
          <li>
            <strong>Docker Desktop</strong>: Settings → Kubernetes → "Enable Kubernetes".
          </li>
          <li>
            <strong>k3d</strong>: <CommandBlock command="k3d cluster create castor" copyLabel={L} />
          </li>
          <li>
            <strong>kind</strong>: <CommandBlock command="kind create cluster" copyLabel={L} />
          </li>
          <li>
            <strong>minikube</strong>: <CommandBlock command="minikube start" copyLabel={L} />
          </li>
        </ul>
        <p className="help-p help-note">
          The kubeconfig is typically at <code>~/.kube/config</code> (Windows:{" "}
          <code>C:\Users\&lt;you&gt;\.kube\config</code>).
        </p>
      </Section>

      <Section title="Step 2 — Mount the kubeconfig into Castor">
        <p className="help-p">
          Mount the file into the Castor container and point <code>CASTOR_KUBECONFIG</code> at it.
          Additions to <code>docker run</code>:
        </p>
        <CommandBlock
          command="-v $HOME/.kube/config:/home/nonroot/.kube/config:ro -e CASTOR_KUBECONFIG=/home/nonroot/.kube/config"
          copyLabel={L}
        />
        <p className="help-p">docker-compose equivalent:</p>
        <CommandBlock
          command={
            "services:\n  castor:\n    volumes:\n      - ~/.kube/config:/home/nonroot/.kube/config:ro\n    environment:\n      CASTOR_KUBECONFIG: /home/nonroot/.kube/config"
          }
          copyLabel={L}
        />
      </Section>

      <Section title="⚠️ The #1 gotcha — API server address">
        <p className="help-p">
          The kubeconfig's <code>server:</code> address must be reachable <strong>from inside the
          container</strong>. A <code>127.0.0.1</code> address (common with Docker Desktop, k3d, kind,
          minikube) will <strong>not</strong> work from inside the container — there, loopback points at
          the container itself, not your host.
        </p>
        <p className="help-p">
          Replace it with <code>host.docker.internal</code> (Docker Desktop) or your machine's LAN IP,
          e.g.:
        </p>
        <CommandBlock command="server: https://host.docker.internal:6443" copyLabel={L} />
      </Section>

      <Section title="Verify from the host">
        <CommandBlock command="kubectl get nodes" copyLabel={L} />
        <CommandBlock command="kubectl get pods -A" copyLabel={L} />
      </Section>

      <Section title="Using Castor">
        <p className="help-p">
          Once connected, the Kubernetes page lists <strong>pods / deployments / nodes</strong> by
          namespace and lets you <strong>scale</strong> deployments, <strong>rollout restart</strong>,{" "}
          <strong>delete</strong> pods / deployments, and <strong>apply YAML manifests</strong>{" "}
          (server-side apply).
        </p>
      </Section>

      <Section title="Best practices">
        <ul className="help-ul">
          <li>Use <strong>namespaces</strong> to isolate workloads.</li>
          <li>
            Apply <strong>RBAC</strong>: a least-privilege ServiceAccount for the kubeconfig Castor uses
            — don't grant it <code>cluster-admin</code> in production.
          </li>
          <li>Set resource <strong>requests / limits</strong>.</li>
          <li>Add <strong>readiness / liveness</strong> probes.</li>
          <li>Prefer <strong>Deployments</strong> over bare Pods.</li>
          <li>Manage manifests with <strong>GitOps</strong>.</li>
          <li><strong>Never</strong> commit kubeconfigs or secrets.</li>
        </ul>
      </Section>

      <Section title="Documentation">
        <DocLink href="https://kubernetes.io/docs/home/" label="Kubernetes — documentation" />
        <DocLink href="https://kubernetes.io/docs/tasks/tools/" label="Install tools (kubectl, local clusters)" />
      </Section>
    </>
  );
}

/* ================================================================== */
/* Panel shell                                                         */
/* ================================================================== */

const TITLES: Record<Topic, Record<Lang, string>> = {
  swarm: { en: "Docker Swarm — setup guide", fr: "Docker Swarm — guide de configuration" },
  kubernetes: { en: "Kubernetes — setup guide", fr: "Kubernetes — guide de configuration" },
};

export function HelpPanel({ topic, open, onClose }: HelpPanelProps) {
  const [lang, setLang] = useState<Lang>("en");

  return (
    <Modal
      open={open}
      wide
      onClose={onClose}
      title={
        <div className="help-head">
          <span>{TITLES[topic][lang]}</span>
          <div className="help-lang" role="group" aria-label="Language">
            <button
              type="button"
              className={`help-lang-btn${lang === "en" ? " active" : ""}`}
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={`help-lang-btn${lang === "fr" ? " active" : ""}`}
              aria-pressed={lang === "fr"}
              onClick={() => setLang("fr")}
            >
              FR
            </button>
          </div>
        </div>
      }
      footer={
        <ActionButton variant="primary" onClick={onClose}>
          {lang === "fr" ? "Fermer" : "Close"}
        </ActionButton>
      }
    >
      <div className="help-body">
        {topic === "swarm" ? <SwarmHelp lang={lang} /> : <KubernetesHelp lang={lang} />}
      </div>
    </Modal>
  );
}
