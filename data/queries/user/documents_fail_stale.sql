-- An import that was still running when the app closed will never finish. Run once at startup, before any new import.
UPDATE documents SET status = 'failed', error = 'The import was interrupted before it finished.' WHERE status IN ('pending', 'processing')
