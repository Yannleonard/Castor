// ui/src/views/NotFound.tsx
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { BeaverMascot } from "../components/icons";
import { ActionButton } from "../components/ActionButton";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <EmptyState
        icon={<BeaverMascot size={64} />}
        title="Page not found"
        message="This page does not exist or has moved. The beaver looked everywhere."
        action={
          <ActionButton variant="primary" onClick={() => navigate("/")}>
            Back to dashboard
          </ActionButton>
        }
      />
    </div>
  );
}
