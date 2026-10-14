"""Moeum server notifications. Standard library only; see AI_NOTIFICATION_INTEGRATION.md."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


class NotificationError(Exception):
    def __init__(self, code, message, status=None, retry_after=None):
        super().__init__(message)
        self.code, self.status, self.retry_after = code, status, retry_after


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the notification key to a redirected destination.


def _base_url(value):
    url = urllib.parse.urlsplit(value.rstrip('/'))
    if (url.username or url.password or url.path or url.query or url.fragment or not url.hostname
            or (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1')))):
        raise NotificationError('CONFIGURATION', 'Use a HTTPS server origin or localhost HTTP origin, without a path.')
    return value.rstrip('/')


def _key(value=None):
    value = value or os.environ.get('MOEUM_NOTIFY_KEY')
    if value:
        return value.strip()
    filename = os.environ.get('MOEUM_NOTIFY_KEY_FILE') or str(Path(__file__).resolve().parents[1] / '.data' / 'notification-api-key.txt')
    try:
        return Path(filename).read_text(encoding='utf-8').strip()
    except OSError as error:
        raise NotificationError('CONFIGURATION', 'Set MOEUM_NOTIFY_KEY or MOEUM_NOTIFY_KEY_FILE to the server notification API key.') from error


def send_notification(title, body, *, source, event_id, server_url=None, key=None, expected_instance_id=None, timeout=25):
    """One attempt. Reuse event_id + content on retries; an ok response means chat was posted."""
    base = _base_url(server_url or os.environ.get('MOEUM_SERVER_URL', 'http://127.0.0.1:3000'))
    payload = {'source': source, 'eventId': event_id, 'title': title, 'body': body}
    if expected_instance_id is not None:
        payload['expectedInstanceId'] = expected_instance_id
    request = urllib.request.Request(base + '/api/notifications', data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _key(key)}, method='POST')
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
            result = json.loads(response.read(32768))
            if not isinstance(result, dict):
                raise NotificationError('INVALID_RESPONSE', 'Server returned an invalid JSON object.')
            if not result.get('ok') or not result.get('posted'):
                raise NotificationError('INVALID_RESPONSE', 'Server did not acknowledge posting.')
            return result
    except urllib.error.HTTPError as error:
        try:
            result = json.loads(error.read(32768))
        except (ValueError, OSError):
            result = {}
        if not isinstance(result, dict):
            result = {}
        try:
            retry_after = int(error.headers.get('Retry-After', ''))
        except (TypeError, ValueError):
            retry_after = None
        raise NotificationError(result.get('code', 'HTTP_' + str(error.code)),
            result.get('error', 'Server returned HTTP ' + str(error.code)), error.code, retry_after) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise NotificationError('NETWORK_ERROR', 'Server is unreachable or the response timed out; retry the same event ID.') from error
    except (ValueError, KeyError) as error:
        raise NotificationError('INVALID_RESPONSE', 'Server returned an invalid JSON response.') from error


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Post a Moeum chat announcement and request mobile push.')
    parser.add_argument('--source', required=True)
    parser.add_argument('--event-id', required=True)
    parser.add_argument('--title', required=True)
    parser.add_argument('--body', required=True)
    parser.add_argument('--server', default=None)
    parser.add_argument('--instance-id', default=None)
    args = parser.parse_args()
    try:
        result = send_notification(args.title, args.body, source=args.source, event_id=args.event_id,
            server_url=args.server, expected_instance_id=args.instance_id)
        print(json.dumps(result, ensure_ascii=False))
    except NotificationError as error:
        print(json.dumps({'ok': False, 'code': error.code, 'error': str(error),
            'status': error.status, 'retryAfter': error.retry_after}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
