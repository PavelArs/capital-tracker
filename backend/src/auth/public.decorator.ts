import { SetMetadata } from '@nestjs/common';
export const PUBLIC_ROUTE = 'publicRoute';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const PENDING_ROUTE = 'pendingRoute';
export const AllowPending = () => SetMetadata(PENDING_ROUTE, true);
