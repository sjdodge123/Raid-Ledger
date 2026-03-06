import { API_BASE_URL } from '../config';
import { getAuthToken } from '../../hooks/use-auth';
import { fetchApi } from './fetch-api';

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

/** XHR-based upload with progress tracking */
function uploadWithProgress(
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
                handleXhrError(xhr, reject);
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.send(formData);
    });
}

/** Parse XHR error response */
function handleXhrError(
    xhr: XMLHttpRequest,
    reject: (err: Error) => void,
): void {
    try {
        const error = JSON.parse(xhr.responseText) as { message?: string };
        reject(new Error(error.message || `HTTP ${xhr.status}`));
    } catch {
        reject(new Error(`HTTP ${xhr.status}`));
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
