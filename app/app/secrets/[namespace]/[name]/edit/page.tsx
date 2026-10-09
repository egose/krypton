import { EditSecretView } from '@/components/edit-secret-view';

// Authenticated, per-request route over live K8s data: render on the server
// at request time instead of prerendering a static shell.
export const instant = false;

export default async function EditSecretPage(props: PageProps<'/secrets/[namespace]/[name]/edit'>) {
  const { namespace, name } = await props.params;
  return <EditSecretView namespace={namespace} name={name} />;
}
