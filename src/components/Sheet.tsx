import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Panel } from './px';

/** Pixel-Dialog über dem Spiel; Klick daneben schließt. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-[#0e0a16]/75 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          <motion.div initial={{ y: 12 }} animate={{ y: 0 }} className="max-h-full w-full max-w-sm overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <Panel tone="wood" className="px-1">
              {children}
            </Panel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
