import { useSyncExternalStore } from 'react';
import { subscribeConfirm, getConfirmRequest, settleConfirm } from '../lib/confirm';
import ConfirmModal from './ui/ConfirmModal';

/** Renders the pending confirm() request, if any. Mount once near the app root. */
export default function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirmRequest, getConfirmRequest);
  if (!request) return null;

  return (
    <ConfirmModal
      key={request.title + request.message}
      layer={9500}
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      onConfirm={() => settleConfirm(true)}
      onCancel={() => settleConfirm(false)}
    />
  );
}
