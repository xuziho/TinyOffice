# External Mattermost Reference

TinyOffice no longer treats Mattermost as a product foundation or runtime adapter. The current repository should stay readable as the new TinyOffice product and no longer keeps Mattermost runtime adapter code.

The separately checked-out Mattermost fork is an external historical reference only. It can be inspected for mature chat product patterns, while the standalone TinyOffice frontend remains the active product foundation. Its filesystem location is operator-specific and is not part of the TinyOffice repository contract.

The deleted pre-shadcn local primitive path remains historical context only; new product UI belongs in `apps/tinyoffice-web-shadcn`.

Do not import Mattermost Team/User/Channel/Post APIs, DTOs, storage assumptions, or plugin entrypoints into TinyOffice product work.

Current TinyOffice Chat, Message, Channel, realtime, and frontend work must use TinyOffice-owned company, member, conversation, message, runtime, and evidence contracts.

Chat/Conversation/Message work belongs to TinyOffice-owned APIs. The retired Mattermost webapp hook `registry.registerRootComponent` is historical reference material only, not a current product entrypoint.

Broader non-image Chat attachments stay a future capability boundary. Channel/Topic context selection is a TinyOffice-owned progressive-disclosure contract.
