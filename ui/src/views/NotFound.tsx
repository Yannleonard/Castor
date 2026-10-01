// Castor by IT Leonard
// ui/src/views/NotFound.tsx
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { BeaverMascot } from "../components/icons";
import { ActionButton } from "../components/ActionButton";
import { useT } from "../i18n";
import { notFoundDict } from "../i18n/locales/notFound";

export function NotFound() {
  const navigate = useNavigate();
  const t = useT(notFoundDict);
  return (
    <div className="page">
      <EmptyState
        icon={<BeaverMascot size={64} />}
        title={t("empty.title")}
        message={t("empty.message")}
        action={
          <ActionButton variant="primary" onClick={() => navigate("/")}>
            {t("action.back")}
          </ActionButton>
        }
      />
    </div>
  );
}
