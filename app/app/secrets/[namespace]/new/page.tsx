import { CreateSecretView } from '@/components/create-secret-view';

// Authenticated, per-request route over live K8s data: render on the server
// at request time instead of prerendering a static shell.
export const instant = false;

export default async function NewSecretPage(props: PageProps<'/secrets/[namespace]/new'>) {
  const { namespace } = await props.params;
  return <CreateSecretView namespace={namespace} />;
}
