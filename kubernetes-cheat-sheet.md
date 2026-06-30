# Kubernetes Cheat Sheet

## Cluster

```bash
kubectl get nodes
```

Shows all nodes in the Kubernetes cluster.

```bash
kubectl get namespaces
```

Shows all namespaces in the cluster.

```bash
kubectl get pods -A
```

Shows all pods across all namespaces.

---

## Namespace

```bash
kubectl -n render-platform get pods
```

Shows all pods in the `render-platform` namespace.

```bash
kubectl -n render-platform get svc
```

Shows all services in the `render-platform` namespace.

```bash
kubectl -n render-platform get deployments
```

Shows all deployments in the `render-platform` namespace.

---

## Manifests

```bash
ls k8s
```

Shows all Kubernetes manifest files in the `k8s` directory.

```bash
kubectl apply -f k8s/
```

Applies all Kubernetes manifests from the `k8s` directory.
Creates new resources or updates existing ones.

```bash
kubectl apply -f k8s/mock-render-node.yaml
```

Applies only the `mock-render-node` manifest.

---

## Local LoadBalancer

For Docker Desktop Kubernetes, first enable Kubernetes in Docker Desktop settings and confirm the local cluster is active:

```bash
kubectl get nodes
```

Apply this project's manifests:

```bash
kubectl apply -f k8s/
```

Verify the services:

```bash
kubectl get svc -n render-platform
curl http://localhost:8000/health
open http://localhost:5173
```

Expected local routes on Docker Desktop:

- `http://localhost:5173` -> `frontend:5173`
- `http://localhost:8000` -> `api:8000`
- `http://localhost:8080` -> `gateway:8080`

MongoDB is intentionally not exposed through LoadBalancer; it stays internal at `mongo:27017`.

---

## Docker images

```bash
docker build -t render-api:loadbalancer ./services/api
```

Builds the local Docker image for the API service.

```bash
docker build -t render-gateway:loadbalancer ./services/gateway
```

Builds the local Docker image for the gateway service.

```bash
docker build -t render-frontend:local ./apps/frontend
```

Builds the local Docker image for the frontend service.

```bash
docker build -t render-mock-render-node:local ./services/mock-render-node
```

Builds the local Docker image for the mock render node.

```bash
docker build -t render-unity-renderer:local ./services/unity-renderer
```

Builds the local Docker image for the Unity renderer. The Unity Linux player artifacts must already exist in `services/unity-renderer/builds`.

```bash
docker images | grep render
```

Shows local Docker images related to this project.

---

## Check manifest image settings

```bash
grep -R "image:" k8s/
```

Shows which Docker images are used by Kubernetes manifests.

```bash
grep -R "imagePullPolicy" k8s/
```

Shows the image pull policy used by the manifests.

---

## Port forwarding

Prefer Local LoadBalancer for normal browser development. These commands are still useful for debugging individual services.

```bash
kubectl -n render-platform port-forward svc/frontend 5173:5173
```

Forwards the frontend service to:

```text
http://localhost:5173
```

```bash
kubectl -n render-platform port-forward svc/api 30080:8000
```

Forwards local port `30080` to the API service port `8000`.

```bash
kubectl -n render-platform port-forward svc/gateway 30081:8080
```

Forwards local port `30081` to the gateway service port `8080`.

---

## Logs

```bash
kubectl -n render-platform logs deployment/api
```

Shows API logs.

```bash
kubectl -n render-platform logs deployment/frontend
```

Shows frontend logs.

```bash
kubectl -n render-platform logs deployment/gateway
```

Shows gateway logs.

```bash
kubectl -n render-platform logs deployment/mock-render-node
```

Shows mock render node logs.

```bash
kubectl -n render-platform logs deployment/unity-renderer
```

Shows Unity renderer logs.

---

## Restart deployments

```bash
kubectl -n render-platform rollout restart deployment/api
```

Restarts the API deployment.

```bash
kubectl -n render-platform rollout restart deployment/frontend
```

Restarts the frontend deployment.

```bash
kubectl -n render-platform rollout restart deployment/unity-renderer
```

Restarts the Unity renderer deployment.

```bash
kubectl -n render-platform rollout restart deployment/gateway
```

Restarts the gateway deployment.

```bash
kubectl -n render-platform rollout restart deployment/mock-render-node
```

Restarts the mock render node deployment.

---

## Useful project checks

```bash
ls services
```

Shows available application services.

```bash
find . -maxdepth 4 -name "Dockerfile"
```

Finds Dockerfiles in the project.

```bash
grep -R "process.env" services/mock-render-node
```

Shows environment variables used by the mock render node.

```bash
grep -R "No render node is registered" .
```

Finds where the gateway error message is defined in the codebase.
