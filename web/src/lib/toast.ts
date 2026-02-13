import { toast as sonnerToast } from 'sonner';

// Capture the original error function before we override it (ROK-127 AC-2)
const originalError = sonnerToast.error.bind(sonnerToast);

const errorWithPersist: typeof sonnerToast.error = (message, opts?) =>
  originalError(message, { duration: Infinity, ...opts });

export const toast = Object.assign(sonnerToast, {
  error: errorWithPersist,
});
