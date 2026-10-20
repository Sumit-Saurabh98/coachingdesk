// The app's ONE API client. Screens import { api } from '@/api'.
import { ApiClient } from './api-client';
import { apiBaseUrl } from './config';

export const api = new ApiClient({ baseUrl: apiBaseUrl() });

export { ApiError } from './api-error';
export { queryClient } from './query-client';
