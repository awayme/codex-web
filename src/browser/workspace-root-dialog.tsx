import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CloseIcon, FolderIcon, UpIcon } from "./icons";

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type WorkspaceDirectoryEntries = {
  directoryPath: string;
  parentPath: string | null;
  entries: WorkspaceDirectoryEntry[];
};

const TITLE_ID = "codex-web-workspace-root-dialog-title";
const DESCRIPTION_ID = "codex-web-workspace-root-dialog-description";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function WorkspaceRootDialog({
  listDirectory,
  allowMultiple = false,
  title = "Select project folder",
  onClose,
}: WorkspaceRootDialogOptions & {
  onClose: (value: string[] | null) => void;
}): React.ReactElement {
  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [userSelectedPaths, setUserSelectedPaths] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const directoryQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => listDirectory(directoryPath),
    queryKey: ["workspace-directory-entries", directoryPath],
    retry: false,
  });
  const entries = useMemo(
    () =>
      directoryQuery.data?.entries.filter(
        (entry) => entry.type === "directory",
      ) ?? [],
    [directoryQuery.data?.entries],
  );
  const parentPath = directoryQuery.data?.parentPath ?? null;
  const isBusy = directoryQuery.isFetching;
  const isLoading = directoryQuery.isPending && !directoryQuery.data;
  const queryError = directoryQuery.isError
    ? errorMessage(directoryQuery.error)
    : null;

  function navigateTo(nextDirectoryPath: string): void {
    if (!allowMultiple) setUserSelectedPaths([nextDirectoryPath]);
    setDirectoryPath(nextDirectoryPath);
  }

  function selectPath(path: string): void {
    setUserSelectedPaths((paths) =>
      !allowMultiple
        ? [path]
        : paths.includes(path)
          ? paths.filter((value) => value !== path)
          : [...paths, path],
    );
  }

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(null);
      }
    }

    const element = dialogRef.current;
    element?.addEventListener("keydown", handleKeyDown);
    return () => element?.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const selectedPath =
    userSelectedPaths[0] ?? directoryQuery.data?.directoryPath;
  const selectedPaths = allowMultiple
    ? userSelectedPaths
    : selectedPath
      ? [selectedPath]
      : [];

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selectedPaths.length > 0 && !isBusy && !queryError) {
      onClose(selectedPaths);
    }
  }

  const selectedPathValue =
    (allowMultiple ? directoryQuery.data?.directoryPath : selectedPath) ?? "";

  return (
    <>
      <div
        aria-hidden="true"
        className={[
          "extension:bg-token-editor-background/80",
          "electron:bg-[#00000022]",
          "codex-dialog-overlay",
          "fixed",
          "inset-0",
          "z-50",
        ].join(" ")}
        data-state="open"
        onClick={() => onClose(null)}
        style={{ pointerEvents: "auto" }}
      />
      <div
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        aria-modal="true"
        className={[
          "codex-dialog",
          "left-1/2",
          "top-1/2",
          "z-50",
          "-translate-x-1/2",
          "-translate-y-1/2",
          "outline-none",
          "fixed",
          "bg-token-dropdown-background/90",
          "text-token-foreground",
          "ring-token-border",
          "max-w-[92vw]",
          "rounded-3xl",
          "ring-[0.5px]",
          "ring-token-border",
          "shadow-lg",
          "backdrop-blur-xl",
          "w-[520px]",
        ].join(" ")}
        data-state="open"
        ref={dialogRef}
        role="dialog"
        style={{ pointerEvents: "auto" }}
        tabIndex={-1}
      >
        <form
          className={["flex", "flex-col", "gap-0"].join(" ")}
          onSubmit={handleSubmit}
        >
          <div
            className={[
              "flex",
              "flex-col",
              "gap-0",
              "px-5",
              "py-5",
              "text-base",
              "leading-normal",
              "tracking-normal",
            ].join(" ")}
          >
            <div
              className={[
                "flex",
                "w-full",
                "flex-col",
                "pt-3",
                "first:pt-0",
              ].join(" ")}
            >
              <div
                className={["flex", "flex-col", "items-start", "gap-3"].join(
                  " ",
                )}
              >
                <div
                  className={[
                    "flex",
                    "min-w-0",
                    "flex-1",
                    "flex-col",
                    "gap-1",
                    "self-stretch",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "heading-dialog",
                      "min-w-0",
                      "font-semibold",
                    ].join(" ")}
                    id={TITLE_ID}
                  >
                    {title}
                  </div>
                  <div className={["sr-only"].join(" ")} id={DESCRIPTION_ID}>
                    Choose folders on the Codex Web host.
                  </div>
                </div>
              </div>
            </div>

            <div
              className={[
                "flex",
                "w-full",
                "flex-col",
                "pt-3",
                "first:pt-0",
                "gap-2",
              ].join(" ")}
            >
              <label className={["flex", "flex-col", "gap-0.5"].join(" ")}>
                <span
                  className={["font-medium", "text-token-text-primary"].join(
                    " ",
                  )}
                >
                  Select folder
                </span>
                <div
                  className={[
                    "flex",
                    "h-70",
                    "min-h-56",
                    "flex-col",
                    "gap-3",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "flex",
                      "min-h-0",
                      "min-w-0",
                      "flex-1",
                      "flex-col",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "mt-1",
                        "mb-2",
                        "flex",
                        "min-w-0",
                        "items-center",
                        "gap-1",
                      ].join(" ")}
                    >
                      <button
                        aria-label="Enclosing folder"
                        className={[
                          "border-token-border",
                          "user-select-none",
                          "no-drag",
                          "cursor-interaction",
                          "flex",
                          "items-center",
                          "gap-1",
                          "border",
                          "whitespace-nowrap",
                          "focus:outline-none",
                          "disabled:cursor-not-allowed",
                          "disabled:opacity-40",
                          "rounded-full",
                          "text-token-description-foreground",
                          "enabled:hover:bg-token-list-hover-background",
                          "data-[state=open]:bg-token-list-hover-background",
                          "border-transparent",
                          "h-token-button-composer-sm",
                          "px-1.5",
                          "py-0",
                          "text-sm",
                          "leading-[18px]",
                          "aspect-square",
                          "items-center",
                          "justify-center",
                          "!px-0",
                          "shrink-0",
                        ].join(" ")}
                        disabled={!parentPath || isBusy}
                        onClick={() => {
                          if (parentPath) {
                            navigateTo(parentPath);
                          }
                        }}
                        type="button"
                      >
                        <UpIcon />
                      </button>
                      <input
                        aria-label="Selected folder path"
                        className={[
                          "w-full",
                          "min-w-0",
                          "flex-1",
                          "rounded-md",
                          "border",
                          "border-token-input-border",
                          "bg-token-input-background",
                          "px-2.5",
                          "py-1.5",
                          "text-sm",
                          "text-token-input-foreground",
                          "outline-none",
                          "disabled:bg-token-foreground/5",
                          "disabled:text-token-text-secondary",
                          "disabled:opacity-100",
                        ].join(" ")}
                        disabled
                        readOnly
                        spellCheck={false}
                        title={selectedPathValue}
                        value={selectedPathValue}
                      />
                    </div>

                    <div
                      className={[
                        "min-h-0",
                        "flex-1",
                        "bg-token-input-background",
                        "border-token-input-border",
                        "flex",
                        "overflow-y-auto",
                        "rounded-lg",
                        "border",
                      ].join(" ")}
                    >
                      <div
                        className={["flex", "w-full", "flex-col", "py-1"].join(
                          " ",
                        )}
                      >
                        {isLoading ? (
                          <div
                            className={[
                              "px-3",
                              "py-2",
                              "text-sm",
                              "text-token-description-foreground",
                            ].join(" ")}
                          >
                            Loading...
                          </div>
                        ) : queryError ? (
                          <div
                            className={[
                              "px-3",
                              "py-2",
                              "text-sm",
                              "text-token-text-error",
                            ].join(" ")}
                          >
                            {queryError}
                          </div>
                        ) : entries.length === 0 ? (
                          <div
                            className={[
                              "px-3",
                              "py-2",
                              "text-sm",
                              "text-token-description-foreground",
                            ].join(" ")}
                          >
                            No folders
                          </div>
                        ) : (
                          entries.map((entry) => {
                            const selected = selectedPaths.includes(entry.path);
                            return (
                              <button
                                className={[
                                  "flex",
                                  "w-full",
                                  "min-w-0",
                                  "self-stretch",
                                  "items-center",
                                  "gap-2",
                                  "px-3",
                                  "py-1.5",
                                  "text-left",
                                  "text-sm",
                                  "hover:bg-token-foreground/5",
                                  selected
                                    ? "bg-token-list-hover-background"
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                data-path={entry.path}
                                aria-pressed={selected}
                                key={entry.path}
                                onClick={() => {
                                  selectPath(entry.path);
                                }}
                                onDoubleClick={() => {
                                  navigateTo(entry.path);
                                }}
                                title={entry.path}
                                type="button"
                              >
                                <FolderIcon />
                                {allowMultiple && (
                                  <span aria-hidden="true">
                                    {selected ? "☑" : "☐"}
                                  </span>
                                )}
                                <span className={["truncate"].join(" ")}>
                                  {entry.name}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </label>
              {allowMultiple && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    disabled={isBusy || !!queryError || !directoryQuery.data}
                    onClick={() => {
                      if (directoryQuery.data)
                        selectPath(directoryQuery.data.directoryPath);
                    }}
                  >
                    {selectedPaths.includes(
                      directoryQuery.data?.directoryPath ?? "",
                    )
                      ? "Deselect current folder"
                      : "Select current folder"}
                  </button>
                  <span>{selectedPaths.length} selected</span>
                </div>
              )}
            </div>

            <div
              className={[
                "flex",
                "w-full",
                "flex-col",
                "pt-3",
                "first:pt-0",
              ].join(" ")}
            >
              <div
                className={[
                  "flex",
                  "w-full",
                  "items-center",
                  "justify-end",
                  "gap-3",
                ].join(" ")}
              >
                <button
                  className={[
                    "border-token-border",
                    "user-select-none",
                    "no-drag",
                    "cursor-interaction",
                    "flex",
                    "items-center",
                    "gap-1",
                    "border",
                    "whitespace-nowrap",
                    "focus:outline-none",
                    "disabled:cursor-not-allowed",
                    "disabled:opacity-40",
                    "rounded-lg",
                    "text-token-description-foreground",
                    "enabled:hover:bg-token-list-hover-background",
                    "data-[state=open]:bg-token-list-hover-background",
                    "border-transparent",
                    "px-4",
                    "py-1.5",
                    "text-base",
                    "leading-[18px]",
                  ].join(" ")}
                  onClick={() => onClose(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={[
                    "border-token-border",
                    "user-select-none",
                    "no-drag",
                    "cursor-interaction",
                    "flex",
                    "items-center",
                    "gap-1",
                    "border",
                    "whitespace-nowrap",
                    "focus:outline-none",
                    "disabled:cursor-not-allowed",
                    "disabled:opacity-40",
                    "rounded-lg",
                    "bg-token-foreground",
                    "enabled:hover:bg-token-foreground/80",
                    "data-[state=open]:bg-token-foreground/80",
                    "text-token-dropdown-background",
                    "px-4",
                    "py-1.5",
                    "text-base",
                    "leading-[18px]",
                  ].join(" ")}
                  disabled={
                    selectedPaths.length === 0 || isBusy || !!queryError
                  }
                  type="submit"
                >
                  {allowMultiple ? "Select folders" : "Select folder"}
                </button>
              </div>
            </div>
          </div>
        </form>

        <button
          aria-label="Close"
          className={[
            "no-drag",
            "absolute",
            "top-4",
            "right-4",
            "cursor-interaction",
            "rounded",
            "p-1",
            "leading-none",
            "text-token-foreground/80",
            "hover:bg-token-toolbar-hover-background",
            "focus:ring-1",
            "focus:ring-token-focus-border",
            "focus:outline-none",
          ].join(" ")}
          onClick={() => onClose(null)}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
    </>
  );
}

function ensureHost(): HTMLElement {
  const DIALOG_ID = "codex-web-workspace-root-dialog";
  let element = document.getElementById(DIALOG_ID);
  if (!element) {
    element = document.createElement("div");
    element.id = DIALOG_ID;
    element.style.position = "relative";
    element.style.zIndex = "2147483647";
    // 避免底层项目创建弹窗把选择器交互当作外部点击或抢走焦点。
    for (const type of ["pointerdown", "focusin", "keydown"]) {
      element.addEventListener(type, (event) => event.stopPropagation());
    }
    document.body.append(element);
  }
  return element;
}

type WorkspaceRootDialogOptions = {
  allowMultiple?: boolean;
  title?: string;
  listDirectory: (
    directoryPath: string | null,
  ) => Promise<WorkspaceDirectoryEntries>;
};

export async function openSelectWorkspaceRootDialog(
  options: WorkspaceRootDialogOptions,
): Promise<string[] | null> {
  const activeElement = document.activeElement;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const { resolveFn, promise } = ((): {
    promise: Promise<string[] | null>;
    resolveFn: (target: string[] | null) => void;
  } => {
    let resolveFn = null;
    const promise = new Promise<string[] | null>((resolve) => {
      resolveFn = resolve;
    });

    return {
      resolveFn: resolveFn as any,
      promise,
    };
  })();

  const reactRoot = createRoot(ensureHost());
  reactRoot.render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceRootDialog {...options} onClose={resolveFn} />
    </QueryClientProvider>,
  );

  const result = await promise;

  reactRoot.unmount();

  if (activeElement instanceof HTMLElement) {
    activeElement.focus();
  }

  return result;
}
