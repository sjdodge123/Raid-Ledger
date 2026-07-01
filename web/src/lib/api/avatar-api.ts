import { API_BASE_URL } from '../config';
import { getAuthToken } from '../../hooks/use-auth';
import { fetchApi } from './fetch-api';
import { ensureFreshToken } from './refresh-client';
import { getAuthMethod } from './silent-reauth';

/** Carries the HTTP status so the caller can branch on 401 for a refresh. */
class AvatarUploadError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'AvatarUploadError';
        this.status = status;
    }
}

/**
 * Upload a custom avatar image with optional progress tracking.
 * Uses XMLHttpRequest for upload progress when onProgress is provided.
 */
export async function uploadAvatar(
    file: File,
    onProgress?: (percent: number) => void,
): Promise<{ customAvatarUrl: string }> {
    const formData = new FormData();
    formData.append('avatar', file);

    if (onProgress) {
        return uploadWithProgress(formData, onProgress);
    }

    const response = await fetchApi<{
        data: { customAvatarUrl: string };
    }>('/users/me/avatar', {
        method: 'POST',
        body: formData,
        headers: {},
    });
    return response.data;
}

/**
 * XHR-based upload with progress tracking. ROK-1367: mirrors fetchApi's
 * transparent on-401 refresh — a single silent token refresh + retry before
 * the error surfaces, so an expired access token doesn't fail the upload.
 */
async function uploadWithProgress(
    formData: FormData,
    onProgress: (percent: number) => void,
): Promise<{ customAvatarUrl: string }> {
    try {
        return await sendAvatarXhr(formData, onProgress);
    } catch (err) {
        if (err instanceof AvatarUploadError && err.status === 401 && getAuthMethod()) {
            if (await ensureFreshToken()) return sendAvatarXhr(formData, onProgress);
        }
        throw err;
    }
}

/** Issue one XHR POST of the avatar, resolving on 2xx / rejecting otherwise. */
function sendAvatarXhr(
    formData: FormData,
    onProgress: (percent: number) => void,
): Promise<{ customAvatarUrl: string }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/users/me/avatar`);

        const token = getAuthToken();
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const response = JSON.parse(xhr.responseText) as {
                    data: { customAvatarUrl: string };
                };
                resolve(response.data);
            } else {
                reject(parseXhrError(xhr));
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.send(formData);
    });
}

/** Build a status-tagged error from an XHR error response. */
function parseXhrError(xhr: XMLHttpRequest): AvatarUploadError {
    try {
        const error = JSON.parse(xhr.responseText) as { message?: string };
        return new AvatarUploadError(xhr.status, error.message || `HTTP ${xhr.status}`);
    } catch {
        return new AvatarUploadError(xhr.status, `HTTP ${xhr.status}`);
    }
}

/**
 * Delete the current user's custom avatar.
 */
export async function deleteCustomAvatar(): Promise<void> {
    return fetchApi('/users/me/avatar', { method: 'DELETE' });
}

/**
 * Admin: remove any user's custom avatar.
 */
export async function adminRemoveAvatar(
    userId: number,
): Promise<void> {
    return fetchApi(`/users/${userId}/avatar`, { method: 'DELETE' });
}
