/** The subset of a transformers.js ProgressInfo this tracker reads. */
export type FileProgressEvent =
  | { status: 'initiate'; file: string }
  | { status: 'progress'; file: string; loaded: number; total: number }
  | { status: string; file?: string }

/**
 * Folds the per-file progress of every model file into one overall fraction.
 *
 * Both models load in parallel, about ten files that each report many times a second. Reporting
 * them one by one made the indicator jump between files, so this reports one number instead.
 *
 * Invariants:
 * - The reported fraction never goes down, even when a newly started file raises the byte total.
 * - It reports only when the whole percent changes, so the status channel is not flooded.
 */
export function createDownloadProgressTracker(
  onProgress: (progress: number) => void,
): (event: FileProgressEvent) => void {
  const bytesByFile = new Map<string, { loaded: number; total: number }>()
  let reportedPercent = -1

  return event => {
    if (event.status !== 'progress' || !('loaded' in event) || event.total <= 0) {
      return
    }
    bytesByFile.set(event.file, { loaded: event.loaded, total: event.total })

    let loaded = 0
    let total = 0
    for (const bytes of bytesByFile.values()) {
      loaded += bytes.loaded
      total += bytes.total
    }
    const percent = Math.floor((Math.min(loaded, total) / total) * 100)
    if (percent > reportedPercent) {
      reportedPercent = percent
      onProgress(percent / 100)
    }
  }
}
