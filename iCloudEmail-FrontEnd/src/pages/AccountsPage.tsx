import { AccountsContent } from '../features/accounts/AccountsContent';
import { useAccountsPage } from '../features/accounts/useAccountsPage';

export function AccountsPage() {
  const controller = useAccountsPage();
  return <AccountsContent controller={controller} />;
}
