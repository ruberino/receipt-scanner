import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const TOAST_DURATION_MS = 3000;
// A toast with an action (usually "Angre") stays up twice as long, so there is time to read it,
// decide, and reach the button (T31).
const TOAST_WITH_ACTION_DURATION_MS = 6000;

export type ToastAction = {
  actionLabel: string;
  onAction: () => void;
};

type ToastState = {
  text: string;
  action?: ToastAction;
};

type ToastContextValue = {
  showToast: (text: string, action?: ToastAction) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, action?: ToastAction) => {
    if (timeoutId.current !== null) {
      clearTimeout(timeoutId.current);
    }
    setToast({ text, action });
    timeoutId.current = setTimeout(
      () => {
        setToast(null);
        timeoutId.current = null;
      },
      action ? TOAST_WITH_ACTION_DURATION_MS : TOAST_DURATION_MS,
    );
  }, []);

  useEffect(
    () => () => {
      if (timeoutId.current !== null) {
        clearTimeout(timeoutId.current);
      }
    },
    [],
  );

  function handleAction() {
    if (timeoutId.current !== null) {
      clearTimeout(timeoutId.current);
      timeoutId.current = null;
    }
    toast?.action?.onAction();
    setToast(null);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast !== null && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 mx-auto flex w-fit items-center gap-3 rounded bg-gray-900 px-4 py-2 text-white shadow-lg"
        >
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={handleAction}
              className="min-h-11 min-w-11 font-medium text-blue-300"
            >
              {toast.action.actionLabel}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
