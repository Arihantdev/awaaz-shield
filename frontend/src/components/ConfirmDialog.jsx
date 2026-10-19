import * as Dialog from "@radix-ui/react-dialog";
import { useT } from "../i18n";

export default function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, danger = false }) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal" aria-describedby="confirm-desc">
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description id="confirm-desc" className="modal-desc">{description}</Dialog.Description>
          <div className="modal-actions">
            <Dialog.Close asChild>
              <button className="btn btn-ghost">{t("common.cancel")}</button>
            </Dialog.Close>
            <button
              className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
