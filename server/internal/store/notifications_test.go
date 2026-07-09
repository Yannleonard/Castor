package store

import (
	"bytes"
	"context"
	"testing"
)

func TestNotificationChannelCRUD(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	ch := &NotificationChannel{
		ID:      NewUUID(),
		Name:    "ops-discord",
		Type:    "discord",
		URLEnc:  []byte("sealed-blob-1"),
		Events:  []string{"container.down", "update.available"},
		Enabled: true,
	}
	if err := st.CreateNotificationChannel(ctx, ch); err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	if ch.CreatedAt == 0 || ch.UpdatedAt == 0 {
		t.Errorf("timestamps not set on create")
	}

	got, err := st.GetNotificationChannel(ctx, ch.ID)
	if err != nil {
		t.Fatalf("GetNotificationChannel: %v", err)
	}
	if got.Name != "ops-discord" || got.Type != "discord" || !got.Enabled {
		t.Errorf("got %+v", got)
	}
	if !bytes.Equal(got.URLEnc, []byte("sealed-blob-1")) {
		t.Errorf("URLEnc did not round-trip")
	}
	if len(got.Events) != 2 || got.Events[0] != "container.down" {
		t.Errorf("events = %v", got.Events)
	}
	if !got.SubscribedTo("container.down") || got.SubscribedTo("bogus") {
		t.Errorf("SubscribedTo mismatch")
	}

	list, err := st.ListNotificationChannels(ctx)
	if err != nil {
		t.Fatalf("ListNotificationChannels: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("list len = %d want 1", len(list))
	}

	// Update WITHOUT touching the sealed URL.
	upd := &NotificationChannel{
		ID:      ch.ID,
		Name:    "ops-renamed",
		Type:    "slack",
		Events:  []string{"container.down"},
		Enabled: false,
	}
	if err := st.UpdateNotificationChannel(ctx, upd, false); err != nil {
		t.Fatalf("UpdateNotificationChannel(keep url): %v", err)
	}
	got, _ = st.GetNotificationChannel(ctx, ch.ID)
	if got.Name != "ops-renamed" || got.Type != "slack" || got.Enabled {
		t.Errorf("update not applied: %+v", got)
	}
	if !bytes.Equal(got.URLEnc, []byte("sealed-blob-1")) {
		t.Errorf("URLEnc must be untouched when setURL=false")
	}
	if len(got.Events) != 1 {
		t.Errorf("events = %v", got.Events)
	}

	// Update WITH a new sealed URL.
	upd.URLEnc = []byte("sealed-blob-2")
	if err := st.UpdateNotificationChannel(ctx, upd, true); err != nil {
		t.Fatalf("UpdateNotificationChannel(set url): %v", err)
	}
	got, _ = st.GetNotificationChannel(ctx, ch.ID)
	if !bytes.Equal(got.URLEnc, []byte("sealed-blob-2")) {
		t.Errorf("URLEnc must be replaced when setURL=true")
	}

	// Delete, then everything must be ErrNotFound.
	if err := st.DeleteNotificationChannel(ctx, ch.ID); err != nil {
		t.Fatalf("DeleteNotificationChannel: %v", err)
	}
	if _, err := st.GetNotificationChannel(ctx, ch.ID); err != ErrNotFound {
		t.Errorf("Get after delete = %v want ErrNotFound", err)
	}
	if err := st.UpdateNotificationChannel(ctx, upd, false); err != ErrNotFound {
		t.Errorf("Update missing = %v want ErrNotFound", err)
	}
	if err := st.DeleteNotificationChannel(ctx, ch.ID); err != ErrNotFound {
		t.Errorf("Delete missing = %v want ErrNotFound", err)
	}
}

func TestNotificationChannelTypeCheckConstraint(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	err := st.CreateNotificationChannel(ctx, &NotificationChannel{
		ID:     NewUUID(),
		Name:   "bad",
		Type:   "carrier-pigeon",
		URLEnc: []byte("x"),
	})
	if err == nil {
		t.Fatalf("CHECK(type) must reject unknown channel types")
	}
}
