import { toast as sonnerToast } from 'sonner';

// Re-export toast with error toasts configured to persist (ROK-127 AC-2)
const errorWithPersist: typeof sonnerToast.error = (message, opts?) =>
  sonnerToast.error(message, { duration: Infinity, ...opts });

export const toast = Object.assign(sonnerToast, {
  error: errorWithPersist,
});
