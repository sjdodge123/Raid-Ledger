/**
 * ROK-1960 L3 — what a drop onto the upload zone holds: a single dropped
 * folder is read one level deep (its name keys the campaign, CONTRACT §3.3);
 * anything else is the bare file list with no folder name. Which `.lsv` to
 * read is `selectBg3SaveSource`'s call, not this one.
 *
 * The entry/transfer types are the structural slice of the File and Directory
 * Entries API this reads; a real `DataTransfer` satisfies them, and so does a
 * plain test double.
 */

export interface Bg3DroppedFiles {
    readonly files: readonly File[];
    readonly folderName: string | null;
}

export interface Bg3DropEntry {
    readonly name: string;
    readonly isFile: boolean;
    readonly isDirectory: boolean;
}

export interface Bg3DropFileEntry extends Bg3DropEntry {
    file(success: (file: File) => void, error?: (err: DOMException) => void): void;
}

export interface Bg3DropDirectoryReader {
    readEntries(success: (entries: Bg3DropEntry[]) => void, error?: (err: DOMException) => void): void;
}

export interface Bg3DropDirectoryEntry extends Bg3DropEntry {
    createReader(): Bg3DropDirectoryReader;
}

export interface Bg3DropTransfer {
    /** jsdom and some browsers hand over no `items`; `files` is the fallback. */
    readonly items?: ArrayLike<{ webkitGetAsEntry(): Bg3DropEntry | null }>;
    readonly files: ArrayLike<File>;
}

const isDirectory = (entry: Bg3DropEntry): entry is Bg3DropDirectoryEntry => entry.isDirectory;
const isFile = (entry: Bg3DropEntry): entry is Bg3DropFileEntry => entry.isFile;

/** `readEntries` hands back batches until an empty one. */
async function readAllEntries(reader: Bg3DropDirectoryReader): Promise<Bg3DropEntry[]> {
    const all: Bg3DropEntry[] = [];
    for (;;) {
        const batch = await new Promise<Bg3DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) return all;
        all.push(...batch);
    }
}

const fileOf = (entry: Bg3DropFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

function entriesOf(dt: Bg3DropTransfer): Bg3DropEntry[] {
    const items = dt.items;
    if (!items) return [];
    return Array.from(items, (item) => item.webkitGetAsEntry()).filter((e): e is Bg3DropEntry => e !== null);
}

export async function readDroppedFiles(dt: Bg3DropTransfer): Promise<Bg3DroppedFiles> {
    const entries = entriesOf(dt);
    const [only] = entries;
    if (entries.length === 1 && only && isDirectory(only)) {
        const children = await readAllEntries(only.createReader());
        return { files: await Promise.all(children.filter(isFile).map(fileOf)), folderName: only.name };
    }
    return { files: Array.from(dt.files), folderName: null };
}
