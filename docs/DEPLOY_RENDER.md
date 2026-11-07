# Despliegue del render propio (Cloud Run Job)

**Quién:** CC, con la cuenta `claude-ops` (roles de despliegue dados por Sam el 2026-11-07), **después del merge** y
desde `main` (HRD-R14). **Dónde:** proyecto `gen-lang-client-0491381650`, región `us-central1`.

| Pieza | Valor |
|---|---|
| Repositorio de imágenes | Artifact Registry `videolab` (Docker) |
| Imagen | `us-central1-docker.pkg.dev/gen-lang-client-0491381650/videolab/render:<sha de main>` |
| Job | `videolab-render`, 2 vCPU, 4 GiB, 900 s por tarea, 0 reintentos |
| Secreto | `SUPABASE_SERVICE_ROLE_KEY` (Secret Manager, lo creó Sam el 2026-11-07) |
| Variables | `SUPABASE_URL`; `JOB_ID` llega por ejecución |
| Identidad | cuenta de servicio de Compute por defecto, con `secretmanager.secretAccessor` sobre el secreto |

```bash
P=gen-lang-client-0491381650; R=us-central1; SHA=$(git rev-parse --short HEAD)
gcloud artifacts repositories create videolab --repository-format=docker --location=$R --project=$P   # una vez
gcloud builds submit render --tag $R-docker.pkg.dev/$P/videolab/render:$SHA --project=$P
gcloud run jobs deploy videolab-render --image $R-docker.pkg.dev/$P/videolab/render:$SHA --region $R --project=$P \
  --cpu 2 --memory 4Gi --task-timeout 900 --max-retries 0 \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest \
  --set-env-vars SUPABASE_URL=https://amlvyycfepwhiindxgzw.supabase.co
# Una ejecución (la lanza api/execute en F6; a mano para probar):
gcloud run jobs execute videolab-render --region $R --project=$P --update-env-vars JOB_ID=<uuid de lab_jobs> --wait
```

**Costo:** sólo por consumo (US$ 0,000044 por segundo de render, `ops_lab_rates`); sin tarifa fija.
