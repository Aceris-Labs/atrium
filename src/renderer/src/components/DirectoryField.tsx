import { useEffect, useRef, useState } from "react";
import { PathInput } from "./PathInput";
import type { GitRepoInfo } from "../../../shared/types";

interface Props {
  directoryPath: string | undefined;
  branch: string | undefined;
  onChange: (next: { directoryPath?: string; branch?: string }) => void;
}

export function DirectoryField({ directoryPath, branch, onChange }: Props) {
  const [localPath, setLocalPath] = useState(directoryPath ?? "");
  const [repoInfo, setRepoInfo] = useState<GitRepoInfo>({ isRepo: false });
  const lastDetectedPathRef = useRef<string | null>(null);

  // Keep local input in sync when the parent value changes (e.g., switching spaces).
  useEffect(() => {
    setLocalPath(directoryPath ?? "");
  }, [directoryPath]);

  // Debounced git detection whenever the path settles.
  useEffect(() => {
    const trimmed = localPath.trim();
    if (!trimmed) {
      setRepoInfo({ isRepo: false });
      lastDetectedPathRef.current = null;
      return;
    }
    const t = setTimeout(async () => {
      const info = await window.api.git.detectRepo(trimmed);
      setRepoInfo(info);
      lastDetectedPathRef.current = trimmed;

      // Commit the path to the parent once we've actually resolved it.
      const pathChanged = trimmed !== (directoryPath ?? "");
      const detectedBranch = info.isRepo ? info.currentBranch : undefined;
      const branchChanged = detectedBranch !== branch;

      if (pathChanged || branchChanged) {
        onChange({
          directoryPath: trimmed || undefined,
          branch: info.isRepo ? detectedBranch : undefined,
        });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPath]);

  function handleBranchSelect(nextBranch: string) {
    if (!localPath.trim() || !nextBranch) return;
    setRepoInfo((prev) => ({ ...prev, currentBranch: nextBranch }));
    onChange({ directoryPath: localPath.trim(), branch: nextBranch });
  }

  return (
    <div className="flex flex-col gap-2">
      <PathInput
        value={localPath}
        onChange={setLocalPath}
        placeholder="~/personal-projects/myproject"
      />
      {repoInfo.isRepo && repoInfo.branches && repoInfo.branches.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-fg-muted">branch</label>
          <select
            className="form-select"
            value={repoInfo.currentBranch ?? ""}
            onChange={(e) => handleBranchSelect(e.target.value)}
          >
            {repoInfo.currentBranch &&
              !repoInfo.branches.includes(repoInfo.currentBranch) && (
                <option value={repoInfo.currentBranch}>
                  {repoInfo.currentBranch}
                </option>
              )}
            {repoInfo.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
