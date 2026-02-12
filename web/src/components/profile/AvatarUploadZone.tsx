import { useRef, useState, useCallback } from 'react';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface AvatarUploadZoneProps {
    onFileSelected: (file: File) => void;
    isUploading: boolean;
    uploadProgress: number;
    currentCustomUrl: string | null;
    onRemove: () => void;
}

export function AvatarUploadZone({
    onFileSelected,
    isUploading,
    uploadProgress,
    currentCustomUrl,
    onRemove,
}: AvatarUploadZoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const validateAndSelect = useCallback(
        (file: File) => {
            setError(null);
            if (!ACCEPTED_TYPES.includes(file.type)) {
                setError('Invalid file type. Use PNG, JPEG, WebP, or GIF.');
                return;
            }
            if (file.size > MAX_FILE_SIZE) {
                setError('File too large. Maximum size is 5MB.');
                return;
            }
            // Show local preview
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            onFileSelected(file);
        },
        [onFileSelected],
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) validateAndSelect(file);
        },
        [validateAndSelect],
    );

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) validateAndSelect(file);
            // Reset so same file can be re-selected
            e.target.value = '';
        },
        [validateAndSelect],
    );

    // Show current custom avatar or local preview while uploading
    const displayUrl = previewUrl ?? currentCustomUrl;

    return (
        <div className="space-y-3">
            <label className="text-sm font-medium text-muted">Upload Custom Avatar</label>

            {/* Drop zone */}
            <div
                className={`relative rounded-xl border-2 border-dashed transition-colors p-4 flex flex-col items-center gap-3 cursor-pointer ${
                    dragOver
                        ? 'border-accent bg-accent/5'
                        : 'border-edge hover:border-muted'
                }`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleChange}
                />

                {/* Preview / placeholder */}
                <div className="relative w-20 h-20">
                    {displayUrl ? (
                        <img
                            src={displayUrl}
                            alt="Avatar preview"
                            className="w-20 h-20 rounded-full object-cover border-2 border-edge"
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-panel border-2 border-edge flex items-center justify-center">
                            <svg
                                className="w-8 h-8 text-dim"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                            </svg>
                        </div>
                    )}

                    {/* Progress overlay */}
                    {isUploading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                                <circle
                                    cx="40"
                                    cy="40"
                                    r="36"
                                    fill="rgba(0,0,0,0.5)"
                                    stroke="none"
                                />
                                <circle
                                    cx="40"
                                    cy="40"
                                    r="36"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    strokeDasharray={`${2 * Math.PI * 36}`}
                                    strokeDashoffset={`${2 * Math.PI * 36 * (1 - uploadProgress / 100)}`}
                                    className="text-accent transition-all duration-200"
                                />
                            </svg>
                            <span className="absolute text-xs font-bold text-white">
                                {uploadProgress}%
                            </span>
                        </div>
                    )}
                </div>

                <div className="text-center">
                    <p className="text-sm text-muted">
                        {dragOver ? 'Drop image here' : 'Click or drag to upload'}
                    </p>
                    <p className="text-xs text-dim mt-1">
                        PNG, JPEG, WebP, or GIF. Max 5MB.
                    </p>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <p className="text-xs text-red-400">{error}</p>
            )}

            {/* Remove button */}
            {currentCustomUrl && !isUploading && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setPreviewUrl(null);
                        onRemove();
                    }}
                    className="w-full text-sm text-red-400 hover:text-red-300 transition-colors py-1"
                >
                    Remove custom avatar
                </button>
            )}
        </div>
    );
}
