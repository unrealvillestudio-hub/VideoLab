// Token de Google para el Cloud Run Job: la identidad adjunta del Job (servidor de metadatos). Sin claves.
export async function accessToken() {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`token de GCP ${res.status}`);
  return (await res.json()).access_token;
}

export async function projectId() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/project/project-id', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`project-id de GCP ${res.status}`);
  return (await res.text()).trim();
}
