import { SecretDetail } from '@/components/secret-detail';

// Authenticated, per-request route over live K8s data: render on the server
// at request time instead of prerendering a static shell.
export const instant = false;

export default async function SecretPage(props: PageProps<'/secrets/[namespace]/[name]'>) {
  const { namespace, name } = await props.params;
  return <SecretDetail namespace={namespace} name={name} />;
}
