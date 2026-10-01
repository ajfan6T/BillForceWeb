import type { AppRoute } from '../../routing';
import { SettingsPage } from './SettingsPage';
import { UsersPage } from './UsersPage';
import { ActivityPage } from './ActivityPage';
import { SupabaseSettingsPage } from './SupabaseSettings';

export const adminPages: AppRoute[] = [
  { path: '/settings', element: <SettingsPage />, perm: 'settings.manage' },
  { path: '/settings/supabase', element: <SupabaseSettingsPage />, perm: 'settings.manage' },
  { path: '/admin/users', element: <UsersPage />, perm: 'users.manage' },
  { path: '/admin/activity', element: <ActivityPage />, perm: 'activity.view' },
];
