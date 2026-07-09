// ui/src/help/cards/kubernetes.ts — Kubernetes setup & usage help card.
import type { HelpCard } from "../types";

export const kubernetesCard: HelpCard = {
  id: "kubernetes",
  title: { en: "Kubernetes — setup guide", fr: "Kubernetes — guide de configuration" },

  en: {
    summary:
      "Connect an existing Kubernetes cluster to Castor through a read-only kubeconfig, then manage pods, deployments, and manifests from the Kubernetes page.",
    sections: [
      {
        title: "What is Kubernetes?",
        blocks: [
          { kind: "p", text: "Kubernetes (K8s) is a large-scale, **declarative** orchestrator with a rich ecosystem. It is more powerful but has a steeper learning curve than Swarm — reach for it on large or demanding deployments." },
        ],
      },
      {
        title: "How Castor connects",
        blocks: [
          { kind: "p", text: "Castor connects to an **existing** cluster, read + write, through a mounted **kubeconfig** — it **does not create** clusters. You provide the file and point Castor at it with the `CASTOR_KUBECONFIG` environment variable. Two steps." },
          { kind: "note", text: "The kubeconfig carries cluster credentials. Mount it **read-only** (`:ro`) and prefer a kubeconfig scoped to a least-privilege ServiceAccount (see best practices below)." },
        ],
      },
      {
        title: "Step 1 — Have a cluster + kubeconfig",
        blocks: [
          { kind: "p", text: "Common local options:" },
          { kind: "list", items: [
            "**Docker Desktop**: Settings → Kubernetes → \"Enable Kubernetes\".",
            "**k3d**: `k3d cluster create castor`",
            "**kind**: `kind create cluster`",
            "**minikube**: `minikube start`",
          ] },
          { kind: "note", text: "The kubeconfig is typically at `~/.kube/config` (Windows: `C:\\Users\\<you>\\.kube\\config`)." },
        ],
      },
      {
        title: "Step 2 — Mount the kubeconfig into Castor",
        blocks: [
          { kind: "p", text: "The recommended way is the ready-made compose overlay `deploy/docker-compose.kube.yml`, which mounts the file **read-only** and sets `CASTOR_KUBECONFIG` for you. Start Castor with it layered on top of the base compose:" },
          { kind: "cmd", command: "docker compose -f docker-compose.yml -f deploy/docker-compose.kube.yml up -d" },
          { kind: "p", text: "If you run Castor with `docker run` instead, add these flags:" },
          { kind: "cmd", command: "-v $HOME/.kube/config:/home/nonroot/.kube/config:ro -e CASTOR_KUBECONFIG=/home/nonroot/.kube/config" },
          { kind: "p", text: "The equivalent compose fragment (what the overlay does):" },
          { kind: "code", code: "services:\n  castor:\n    volumes:\n      - ~/.kube/config:/home/nonroot/.kube/config:ro\n    environment:\n      CASTOR_KUBECONFIG: /home/nonroot/.kube/config" },
        ],
      },
      {
        title: "The #1 gotcha — API server address",
        blocks: [
          { kind: "callout", tone: "warn", text: "The kubeconfig's `server:` address must be reachable **from inside the container**. A `127.0.0.1` / `localhost` address (common with Docker Desktop, k3d, kind, minikube) will **not** work from the container — there, loopback points at the container itself, not your host." },
          { kind: "p", text: "Replace it with an address reachable from the container: `host.docker.internal` (Docker Desktop), your machine's LAN IP, or run Castor with host networking. For example:" },
          { kind: "cmd", command: "server: https://host.docker.internal:6443" },
        ],
      },
      {
        title: "Verify from the host",
        blocks: [
          { kind: "p", text: "Confirm the cluster and credentials work before wiring Castor to them:" },
          { kind: "cmd", command: "kubectl get nodes" },
          { kind: "cmd", command: "kubectl get pods -A" },
        ],
      },
      {
        title: "Using Castor",
        blocks: [
          { kind: "p", text: "Once connected, the Kubernetes page works **per namespace** and lets you inspect and act on the whole cluster: **pods**, **deployments** (scale, rollout restart), **apply YAML** (server-side apply), **HPA** (horizontal pod autoscalers), **namespaces**, **storage** (PVCs), **services**, **configmaps**, **secrets** (keys only — values are never shown), **events**, and **ingress**. **Metrics** (CPU / memory) appear when a **metrics-server** is installed, and you can **exec** into a container and stream **logs**." },
          { kind: "note", text: "Opening a container terminal (exec) always requires a TOTP step-up (2FA), and mutations may require 2FA depending on the \"2FA required for mutations\" setting. RBAC roles (admin / operator / viewer) and dotted permissions gate what each account can do." },
        ],
      },
      {
        title: "Best practices",
        blocks: [
          { kind: "callout", tone: "info", text: "K8s access is read **+ write**, but Castor works fine with a read-scoped kubeconfig — mount a **read-only-scoped** kubeconfig unless you actually need to mutate the cluster from Castor." },
          { kind: "list", items: [
            "Isolate workloads with **namespaces**.",
            "Apply **RBAC**: a least-privilege ServiceAccount for the kubeconfig Castor uses — don't grant it `cluster-admin` in production.",
            "Set resource **requests / limits**.",
            "Add **readiness / liveness** probes.",
            "Prefer **Deployments** over bare Pods.",
            "Manage manifests with **GitOps**.",
            "**Never** commit kubeconfigs or secrets.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://kubernetes.io/docs/home/", label: "Kubernetes — official documentation" },
          { kind: "doc", href: "https://kubernetes.io/docs/tasks/tools/", label: "Install tools (kubectl, local clusters)" },
        ],
      },
    ],
  },

  fr: {
    summary:
      "Connectez un cluster Kubernetes existant à Castor via un kubeconfig monté en lecture seule, puis gérez pods, deployments et manifestes depuis la page Kubernetes.",
    sections: [
      {
        title: "Qu'est-ce que Kubernetes ?",
        blocks: [
          { kind: "p", text: "Kubernetes (K8s) est un orchestrateur **déclaratif** à grande échelle, doté d'un écosystème très riche. Il est plus puissant mais a une courbe d'apprentissage plus raide que Swarm — privilégiez-le pour les déploiements importants ou exigeants." },
        ],
      },
      {
        title: "Comment Castor se connecte",
        blocks: [
          { kind: "p", text: "Castor se connecte à un cluster **existant**, en lecture + écriture, via un **kubeconfig** monté : il **ne crée pas** de cluster. Vous fournissez le fichier et vous y pointez Castor avec la variable d'environnement `CASTOR_KUBECONFIG`. Deux étapes." },
          { kind: "note", text: "Le kubeconfig porte les identifiants du cluster. Montez-le en **lecture seule** (`:ro`) et préférez un kubeconfig limité à un ServiceAccount au moindre privilège (voir les bonnes pratiques plus bas)." },
        ],
      },
      {
        title: "Étape 1 — Disposer d'un cluster + kubeconfig",
        blocks: [
          { kind: "p", text: "Options locales courantes :" },
          { kind: "list", items: [
            "**Docker Desktop** : Settings → Kubernetes → « Enable Kubernetes ».",
            "**k3d** : `k3d cluster create castor`",
            "**kind** : `kind create cluster`",
            "**minikube** : `minikube start`",
          ] },
          { kind: "note", text: "Le kubeconfig se trouve généralement dans `~/.kube/config` (Windows : `C:\\Users\\<vous>\\.kube\\config`)." },
        ],
      },
      {
        title: "Étape 2 — Monter le kubeconfig dans Castor",
        blocks: [
          { kind: "p", text: "La méthode recommandée est l'overlay compose prêt à l'emploi `deploy/docker-compose.kube.yml`, qui monte le fichier en **lecture seule** et positionne `CASTOR_KUBECONFIG` pour vous. Démarrez Castor en le superposant au compose de base :" },
          { kind: "cmd", command: "docker compose -f docker-compose.yml -f deploy/docker-compose.kube.yml up -d" },
          { kind: "p", text: "Si vous lancez Castor avec `docker run` à la place, ajoutez ces options :" },
          { kind: "cmd", command: "-v $HOME/.kube/config:/home/nonroot/.kube/config:ro -e CASTOR_KUBECONFIG=/home/nonroot/.kube/config" },
          { kind: "p", text: "Le fragment compose équivalent (ce que fait l'overlay) :" },
          { kind: "code", code: "services:\n  castor:\n    volumes:\n      - ~/.kube/config:/home/nonroot/.kube/config:ro\n    environment:\n      CASTOR_KUBECONFIG: /home/nonroot/.kube/config" },
        ],
      },
      {
        title: "Le piège n°1 — adresse du serveur API",
        blocks: [
          { kind: "callout", tone: "warn", text: "L'adresse `server:` du kubeconfig doit être joignable **depuis l'intérieur du conteneur**. Une adresse `127.0.0.1` / `localhost` (cas fréquent avec Docker Desktop, k3d, kind, minikube) ne fonctionnera **pas** depuis le conteneur : la boucle locale y désigne le conteneur lui-même, pas votre hôte." },
          { kind: "p", text: "Remplacez-la par une adresse joignable depuis le conteneur : `host.docker.internal` (Docker Desktop), l'IP LAN de votre machine, ou lancez Castor en host networking. Par exemple :" },
          { kind: "cmd", command: "server: https://host.docker.internal:6443" },
        ],
      },
      {
        title: "Vérifier depuis l'hôte",
        blocks: [
          { kind: "p", text: "Confirmez que le cluster et les identifiants fonctionnent avant d'y raccorder Castor :" },
          { kind: "cmd", command: "kubectl get nodes" },
          { kind: "cmd", command: "kubectl get pods -A" },
        ],
      },
      {
        title: "Utilisation dans Castor",
        blocks: [
          { kind: "p", text: "Une fois connecté, la page Kubernetes travaille **par namespace** et permet d'inspecter et d'agir sur tout le cluster : **pods**, **deployments** (scaler, rollout restart), **appliquer du YAML** (server-side apply), **HPA** (autoscalers horizontaux), **namespaces**, **stockage** (PVC), **services**, **configmaps**, **secrets** (clés seulement — les valeurs ne sont jamais affichées), **events** et **ingress**. Les **métriques** (CPU / mémoire) apparaissent lorsqu'un **metrics-server** est installé, et vous pouvez ouvrir un **exec** dans un conteneur et suivre les **logs**." },
          { kind: "note", text: "Ouvrir un terminal dans un conteneur (exec) exige toujours une élévation TOTP (2FA), et les mutations peuvent l'exiger selon le réglage « 2FA requise pour les mutations ». Les rôles RBAC (admin / operator / viewer) et les permissions dottées déterminent ce que chaque compte peut faire." },
        ],
      },
      {
        title: "Bonnes pratiques",
        blocks: [
          { kind: "callout", tone: "info", text: "L'accès K8s est en lecture **+ écriture**, mais Castor fonctionne très bien avec un kubeconfig à portée lecture — montez un kubeconfig **limité à la lecture** sauf si vous avez réellement besoin de muter le cluster depuis Castor." },
          { kind: "list", items: [
            "Isolez les charges avec des **namespaces**.",
            "Appliquez le **RBAC** : un ServiceAccount au moindre privilège pour le kubeconfig utilisé par Castor — pas de `cluster-admin` en production.",
            "Définissez des **requests / limits** de ressources.",
            "Ajoutez des sondes **readiness / liveness**.",
            "Préférez les **Deployments** aux Pods nus.",
            "Gérez les manifestes en **GitOps**.",
            "Ne committez **jamais** de kubeconfig ni de secrets.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://kubernetes.io/docs/home/", label: "Kubernetes — documentation officielle" },
          { kind: "doc", href: "https://kubernetes.io/docs/tasks/tools/", label: "Installer les outils (kubectl, clusters locaux)" },
        ],
      },
    ],
  },
};
