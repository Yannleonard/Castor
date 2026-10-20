package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/store"
)

const activationKeySetting = "activation.key_hash"
const activationOwnerSetting = "activation.owner"
const activationTimeSetting = "activation.activated_at"

var errActivationUnavailable = errors.New("activation service unavailable")

// activationStatus intentionally contains only identity metadata; it exposes no infrastructure information.
type activationStatus struct {
	Active      bool   `json:"active"`
	Owner       string `json:"owner,omitempty"`
	ActivatedAt string `json:"activatedAt,omitempty"`
	HostName   string `json:"hostName,omitempty"`
}

func (s *Server) GetActivationStatus(w http.ResponseWriter, r *http.Request) {
	status := activationStatus{Active: s.store.GetSettingDefault(r.Context(), activationKeySetting, "") != ""}
	status.Owner = s.store.GetSettingDefault(r.Context(), activationOwnerSetting, "")
	status.ActivatedAt = s.store.GetSettingDefault(r.Context(), activationTimeSetting, "")
	if status.Active {
		status.HostName = s.activationHostName(r.Context())
	}
	authz.WriteJSON(w, http.StatusOK, status)
}

func (s *Server) ActivateInstance(w http.ResponseWriter, r *http.Request) {
	var req struct { Key string `json:"key"` }
	if err := decodeJSON(w, r, &req); err != nil { authz.WriteError(w,r,err); return }
	key:=strings.TrimSpace(req.Key)
	if len(key)<32 || len(key)>128 { authz.WriteError(w,r,authz.ErrValidation); return }
	instanceID:=s.store.GetSettingDefault(r.Context(),store.SettingInstanceID,"")
	if instanceID=="" { writeMapped(w,r,errors.New("missing instance id"));return }
	var identity struct { Valid bool `json:"valid"`; Name string `json:"name"`; Email string `json:"email"`; Company string `json:"company"` }
	if err:=fetchActivationIdentity(r.Context(),config.AnnouncementServiceURL+"/api/activation/verify",key,instanceID,s.activationHostName(r.Context()),&identity);err!=nil {
		if errors.Is(err,authz.ErrForbidden) { authz.WriteError(w,r,authz.ErrForbidden) } else { authz.WriteError(w,r,authz.Errorf(authz.ErrInternal,"Activation service unavailable; the key was not saved.")) }
		return
	}
	if !identity.Valid { authz.WriteError(w,r,authz.ErrForbidden); return }
	// The raw key is never persisted. Hash is retained only to show that this local
	// instance has been paired; authoritative revocation is checked by the website.
	digest:=sha256.Sum256([]byte(key))
	writes:=[]struct{k,v string}{{activationKeySetting,hex.EncodeToString(digest[:])},{activationOwnerSetting,activationOwnerLabel(identity)},{activationTimeSetting,time.Now().UTC().Format(time.RFC3339)}}
	for _,item:=range writes { if err:=s.store.SetSetting(r.Context(),item.k,item.v);err!=nil { writeMapped(w,r,err);return } }
	s.GetActivationStatus(w,r)
}

func (s *Server) activationHostName(ctx context.Context) string {
	if s.manager == nil {
		return ""
	}
	if snapshot, ok := s.manager.Store().Get(cache.HostID); ok && snapshot.Engine != nil {
		if name := strings.TrimSpace(snapshot.Engine.Name); name != "" && len(name) <= 255 {
			return name
		}
	}
	return ""
}

func activationOwnerLabel(identity struct { Valid bool `json:"valid"`; Name string `json:"name"`; Email string `json:"email"`; Company string `json:"company"` }) string {
	if company:=strings.TrimSpace(identity.Company);company!="" { return company+" · "+identity.Email }
	if name:=strings.TrimSpace(identity.Name);name!="" { return name+" · "+identity.Email }
	return identity.Email
}

func fetchActivationIdentity(ctx context.Context, endpoint,key,instanceID,hostName string,dst any) error {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "castor.gtek-it.fr" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errActivationUnavailable
	}
	return fetchActivationIdentityWithClient(ctx, endpoint, key, instanceID, hostName, dst, &http.Client{Timeout: 5 * time.Second})
}

func fetchActivationIdentityWithClient(ctx context.Context, endpoint,key,instanceID,hostName string,dst any,client *http.Client) error {
	body,_:=json.Marshal(map[string]string{"key":key,"instanceId":instanceID,"hostName":hostName})
	req,err:=http.NewRequestWithContext(ctx,http.MethodPost,endpoint,bytes.NewReader(body));if err!=nil{return err}
	req.Header.Set("Content-Type","application/json")
	resp,err:=client.Do(req);if err!=nil{return fmt.Errorf("%w: %v",errActivationUnavailable,err)}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode==http.StatusForbidden || resp.StatusCode==http.StatusConflict { return authz.ErrForbidden }
	if resp.StatusCode!=http.StatusOK { return errActivationUnavailable }
	limited, err := io.ReadAll(io.LimitReader(resp.Body, (16<<10)+1))
	if err != nil || len(limited) > 16<<10 {
		return errActivationUnavailable
	}
	decoder:=json.NewDecoder(bytes.NewReader(limited))
	if err:=decoder.Decode(dst);err!=nil{return errActivationUnavailable}
	var extra any
	if err:=decoder.Decode(&extra);err!=io.EOF{return errActivationUnavailable}
	return nil
}
