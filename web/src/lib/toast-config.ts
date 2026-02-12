import { toast } from 'sonner';

// Patch toast.error to persist until manually dismissed (ROK-127 AC-2).
// Sonner's toastOptions prop doesn't support per-type duration overrides,
// so we wrap the original to inject duration: Infinity as the default.
const _originalError = toast.error.bind(toast);
toast.error = ((
  message: Parameters<typeof _originalError>[0],
  opts?: Parameters<typeof _originalError>[1],
) => _originalError(message, { duration: Infinity, ...opts })) as typeof toast.error;
