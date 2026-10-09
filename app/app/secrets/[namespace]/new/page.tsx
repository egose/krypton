import { SecretForm } from '@/components/secret-form';

// Authenticated, per-request route over live K8s data: render on the server
// at request time instead of prerendering a static shell.
export const instant = false;

export default async function NewSecretPage(props: PageProps<'/secrets/[namespace]/new'>) {
  const { namespace } = await props.params;
  return <SecretForm mode="create" namespace={namespace} />;
}
