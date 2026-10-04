import type { AppRoute } from '../../routing';
import { SuppliersListPage } from './SuppliersList';
import { SupplierDetailPage } from './SupplierDetail';
import { PayablesPage } from './Payables';
import { PurchasesListPage } from './PurchasesList';
import { PurchaseFormPage } from './PurchaseForm';
import { PurchaseDetailPage } from './PurchaseDetail';
import { SupplierPaymentsListPage } from './SupplierPaymentsList';
import { SupplierPaymentDetailPage } from './SupplierPaymentDetail';
import { PurchaseOrderDetailPage, PurchaseOrderFormPage, PurchaseOrdersListPage } from './PurchaseOrders';
import { PurchaseReturnDetailPage, PurchaseReturnNewPage, PurchaseReturnsListPage } from './PurchaseReturns';

export const purchasesPages: AppRoute[] = [
  { path: '/suppliers', element: <SuppliersListPage />, perm: 'suppliers.view' },
  { path: '/suppliers/payables', element: <PayablesPage />, perm: 'suppliers.view' },
  { path: '/suppliers/:id', element: <SupplierDetailPage />, perm: 'suppliers.view' },
  { path: '/purchases', element: <PurchasesListPage />, perm: ['suppliers.view', 'purchases.manage'] },
  { path: '/purchases/new', element: <PurchaseFormPage />, perm: 'purchases.manage' },
  { path: '/purchases/payments', element: <SupplierPaymentsListPage />, perm: ['suppliers.view', 'suppliers.pay'] },
  { path: '/purchases/payments/:id', element: <SupplierPaymentDetailPage />, perm: ['suppliers.view', 'suppliers.pay'] },
  { path: '/purchases/orders', element: <PurchaseOrdersListPage />, perm: ['suppliers.view', 'purchases.manage'] },
  { path: '/purchases/orders/new', element: <PurchaseOrderFormPage />, perm: 'purchases.manage' },
  { path: '/purchases/orders/:id', element: <PurchaseOrderDetailPage />, perm: ['suppliers.view', 'purchases.manage'] },
  { path: '/purchases/orders/:id/edit', element: <PurchaseOrderFormPage />, perm: 'purchases.manage' },
  { path: '/purchases/returns', element: <PurchaseReturnsListPage />, perm: ['suppliers.view', 'purchases.manage'] },
  { path: '/purchases/returns/:id', element: <PurchaseReturnDetailPage />, perm: ['suppliers.view', 'purchases.manage'] },
  { path: '/purchases/:id/return', element: <PurchaseReturnNewPage />, perm: 'purchases.manage' },
  { path: '/purchases/:id', element: <PurchaseDetailPage />, perm: ['suppliers.view', 'purchases.manage'] },
  { path: '/purchases/:id/edit', element: <PurchaseFormPage />, perm: 'purchases.manage' },
];
