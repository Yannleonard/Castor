package compose

import "fmt"

// ValidationError is a structural or semantic problem in a compose document.
// Its message is operator-facing and safe to surface verbatim in the API error
// envelope (it never contains secrets — only field names and shapes). The API
// layer maps it to a 422 validation_failed.
type ValidationError struct {
	Msg string
}

func (e *ValidationError) Error() string { return e.Msg }

// validationf builds a *ValidationError with a formatted message.
func validationf(format string, args ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, args...)}
}

// IsValidation reports whether err is a *ValidationError (used by the API layer
// to choose the 422 mapping).
func IsValidation(err error) bool {
	_, ok := err.(*ValidationError)
	return ok
}
