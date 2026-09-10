import {SearchSelect} from '../adapter/SearchSelect';
import {useFieldSources} from '../adapter/FieldSources';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  MERGE_FIELD_PATTERN,
  activeMergeFieldQuery,
  insertMergeField,
  mergeFieldKnown,
  mergeFieldSuggestions,
  type MergeFieldOption,
} from "../lib/mergeFields";

type MergeFieldTextInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> & {
  value: string;
  onChange: (value: string) => void;
  variant?: "boxed" | "bare";
};

type MergeFieldTextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> & {
  value: string;
  onChange: (value: string) => void;
  variant?: "boxed" | "bare";
};

type MenuPosition = {
  left: number;
  top: number;
};

export function MergeFieldTextInput({
  value,
  onChange,
  variant = "boxed",
  className = "",
  onKeyDown,
  ...props
}: MergeFieldTextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [showFields,setShowFields]=useState(false);
  const sources=useFieldSources();
  const [caretIndex, setCaretIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    top: 28,
  });
  const helper = useMergeFieldHelper({
    value,
    caretIndex,
    focused,
    position: menuPosition,
    onInsert: (option) => {
      const next = insertMergeField(value, caretIndex, option);
      onChange(next.value);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(next.caretIndex, next.caretIndex);
        setCaretIndex(next.caretIndex);
      });
    },
  });
  useCaretMenuPosition({
    caretIndex,
    controlRef: inputRef,
    focused,
    multiline: false,
    rootRef,
    setMenuPosition,
    value,
  });
  const boxed =
    "w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm focus-within:border-accent";
  const bare = "min-w-0 flex-1 bg-transparent py-0 text-sm";

  return (
    <span
      ref={rootRef}
      className={`relative block ${variant === "boxed" ? boxed : bare} ${className}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-[inherit] py-[inherit] text-sm text-white"
      >
        {renderHighlightedValue(value, false)}
      </span>
      <input
        {...props}
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setCaretIndex(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) => setCaretIndex(event.currentTarget.selectionStart ?? 0)}
        onFocus={(event) => {
          setFocused(true);
          setCaretIndex(event.currentTarget.selectionStart ?? 0);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          window.setTimeout(() => setFocused(false), 120);
          props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (helper.onKeyDown(event)) return;
          onKeyDown?.(event);
        }}
        className="relative z-10 w-full bg-transparent text-transparent caret-white placeholder:text-neutral-500 selection:bg-accent/30 focus:outline-none"
      />
      <button type="button" aria-label="Insert custom value" title="Custom values" onMouseDown={e=>e.preventDefault()} onClick={()=>setShowFields(!showFields)} className="relative z-20 mt-1 block text-xs text-accent hover:underline">Custom values</button>
      {showFields&&<SearchSelect label="Choose custom value" value="" options={sources.map(f=>({value:f.path,label:f.label,detail:f.group}))} onChange={path=>{const token='{{'+path+'}}';const start=inputRef.current?.selectionStart??value.length;const end=inputRef.current?.selectionEnd??start;onChange(value.slice(0,start)+token+value.slice(end));setShowFields(false);requestAnimationFrame(()=>{inputRef.current?.focus();inputRef.current?.setSelectionRange(start+token.length,start+token.length)})}}/>}
      {helper.menu}
    </span>
  );
}

export function MergeFieldTextarea({
  value,
  onChange,
  variant = "boxed",
  className = "",
  onKeyDown,
  ...props
}: MergeFieldTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [showFields,setShowFields]=useState(false);
  const sources=useFieldSources();
  const [caretIndex, setCaretIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    top: 32,
  });
  const helper = useMergeFieldHelper({
    value,
    caretIndex,
    focused,
    position: menuPosition,
    onInsert: (option) => {
      const next = insertMergeField(value, caretIndex, option);
      onChange(next.value);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.caretIndex, next.caretIndex);
        setCaretIndex(next.caretIndex);
      });
    },
  });
  useCaretMenuPosition({
    caretIndex,
    controlRef: textareaRef,
    focused,
    multiline: true,
    rootRef,
    setMenuPosition,
    value,
  });
  const boxed =
    "w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm focus-within:border-accent";
  const bare = "min-h-0 flex-1 bg-transparent px-3 py-2 text-sm";

  return (
    <span
      ref={rootRef}
      className={`relative block ${variant === "boxed" ? boxed : bare} ${className}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-[inherit] py-[inherit] text-sm leading-relaxed text-white"
      >
        {renderHighlightedValue(value, true)}
      </span>
      <textarea
        {...props}
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setCaretIndex(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) => setCaretIndex(event.currentTarget.selectionStart ?? 0)}
        onFocus={(event) => {
          setFocused(true);
          setCaretIndex(event.currentTarget.selectionStart ?? 0);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          window.setTimeout(() => setFocused(false), 120);
          props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (helper.onKeyDown(event)) return;
          onKeyDown?.(event);
        }}
        className="relative z-10 h-full w-full resize-none bg-transparent text-transparent caret-white placeholder:text-neutral-500 selection:bg-accent/30 focus:outline-none"
      />
      <button type="button" aria-label="Insert custom value" title="Custom values" onMouseDown={e=>e.preventDefault()} onClick={()=>setShowFields(!showFields)} className="relative z-20 mt-1 block text-xs text-accent hover:underline">Custom values</button>
      {showFields&&<SearchSelect label="Choose custom value" value="" options={sources.map(f=>({value:f.path,label:f.label,detail:f.group}))} onChange={path=>{const token='{{'+path+'}}';const start=textareaRef.current?.selectionStart??value.length;const end=textareaRef.current?.selectionEnd??start;onChange(value.slice(0,start)+token+value.slice(end));setShowFields(false);requestAnimationFrame(()=>{textareaRef.current?.focus();textareaRef.current?.setSelectionRange(start+token.length,start+token.length)})}}/>}
      {helper.menu}
    </span>
  );
}

function useMergeFieldHelper({
  value,
  caretIndex,
  focused,
  position,
  onInsert,
}: {
  value: string;
  caretIndex: number;
  focused: boolean;
  position: MenuPosition;
  onInsert: (option: MergeFieldOption) => void;
}) {
  const fieldSources=useFieldSources();
  const active = focused ? activeMergeFieldQuery(value, caretIndex) : null;
  const suggestions = useMemo(
    () => (active ? mergeFieldSuggestions(active.query,fieldSources) : []),
    [active,fieldSources],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const open = focused && active !== null && suggestions.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [active?.query]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      onInsert(suggestions[activeIndex]);
      return true;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return true;
    }
    return false;
  };

  return {
    onKeyDown,
    menu: open ? (
      <MergeFieldMenu
        activeIndex={activeIndex}
        options={suggestions}
        position={position}
        onSelect={onInsert}
      />
    ) : null,
  };
}

function MergeFieldMenu({
  options,
  activeIndex,
  position,
  onSelect,
}: {
  options: Array<MergeFieldOption>;
  activeIndex: number;
  position: MenuPosition;
  onSelect: (option: MergeFieldOption) => void;
}) {
  return (
    <span
      className="absolute z-[10050] block max-h-52 w-[min(260px,calc(100vw-32px))] overflow-y-auto rounded-md border border-edge-strong bg-panel p-1 text-left shadow-2xl"
      style={{ left: position.left, top: position.top }}
    >
      {options.map((option, index) => (
        <button
          key={option.path}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(option);
          }}
          className={`block w-full rounded px-2 py-1.5 text-left transition-colors ${
            index === activeIndex
              ? "bg-accent/15 text-white"
              : "text-neutral-300 hover:bg-raised hover:text-white"
          }`}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs font-medium">
              {option.label}
            </span>
            <span className="shrink-0 rounded bg-raised px-1 py-0.5 font-mono text-[10px] text-accent">
              {`{{${option.path}}}`}
            </span>
          </span>
        </button>
      ))}
    </span>
  );
}

function useCaretMenuPosition({
  value,
  caretIndex,
  focused,
  multiline,
  controlRef,
  rootRef,
  setMenuPosition,
}: {
  value: string;
  caretIndex: number;
  focused: boolean;
  multiline: boolean;
  controlRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  rootRef: React.RefObject<HTMLSpanElement | null>;
  setMenuPosition: (position: MenuPosition) => void;
}) {
  useLayoutEffect(() => {
    if (!focused || !controlRef.current || !rootRef.current) return;
    const active = activeMergeFieldQuery(value, caretIndex);
    if (!active) return;
    setMenuPosition(
      measureCaretMenuPosition({
        caretIndex,
        control: controlRef.current,
        multiline,
        root: rootRef.current,
        value,
      }),
    );
  }, [caretIndex, controlRef, focused, multiline, rootRef, setMenuPosition, value]);
}

function measureCaretMenuPosition({
  control,
  root,
  value,
  caretIndex,
  multiline,
}: {
  control: HTMLInputElement | HTMLTextAreaElement;
  root: HTMLSpanElement;
  value: string;
  caretIndex: number;
  multiline: boolean;
}) {
  const style = window.getComputedStyle(control);
  const rootStyle = window.getComputedStyle(root);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const rootPaddingLeft = parseFloat(rootStyle.paddingLeft) || 0;
  const rootPaddingTop = parseFloat(rootStyle.paddingTop) || 0;
  const lineHeight =
    parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: multiline ? "pre-wrap" : "pre",
    wordBreak: multiline ? "break-word" : "normal",
    overflowWrap: multiline ? "break-word" : "normal",
    width: multiline ? `${control.clientWidth}px` : "auto",
    font: style.font,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    padding: style.padding,
    border: style.border,
  });
  mirror.textContent = value.slice(0, caretIndex);
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const left = Math.min(
    Math.max(rootPaddingLeft, rootPaddingLeft + marker.offsetLeft - control.scrollLeft),
    Math.max(rootPaddingLeft, root.clientWidth - 268),
  );
  const top = Math.min(
    Math.max(rootPaddingTop + lineHeight + 4, rootPaddingTop + marker.offsetTop - control.scrollTop + lineHeight + 6),
    root.clientHeight + 6,
  );
  mirror.remove();
  return { left, top };
}

function renderHighlightedValue(value: string, multiline: boolean) {
  if (!value) return null;
  const parts: Array<ReactNode> = [];
  let lastIndex = 0;
  MERGE_FIELD_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(MERGE_FIELD_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(value.slice(lastIndex, index));
    }
    const path = match[1];
    parts.push(
      <span
        key={`${path}-${index}`}
        className={`rounded px-0.5 font-medium ${
          mergeFieldKnown(path)
            ? "bg-accent/15 text-accent"
            : "bg-amber-500/15 text-amber-200"
        }`}
      >
        {match[0]}
      </span>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) parts.push(value.slice(lastIndex));
  if (multiline && value.endsWith("\n")) parts.push(" ");
  return parts;
}
