---
title: Events
description: Every event Castwright receives from Twitch, what triggers it and which fields it carries.
sidebar:
  order: 1
---

Everything that happens on your channel arrives in Castwright as an event. Alerts, actions, overlays and the Activity page all read the same fields.

## Common fields

Every event has these fields. Fields that don't apply are empty (`null`).

| Field | What it holds |
| --- | --- |
| `id` | Twitch message ID. Chat events use the chat message ID. |
| `kind` | The event kind, for example `cheer`. See the table below. |
| `ts` | Time of the event, in milliseconds since 1 January 1970 (a Unix timestamp). |
| `user.id`, `user.login`, `user.display_name` | Who did it. Empty for anonymous gifts and cheers, and for channel-wide events like polls. |
| `name` | Shortcut for `user.display_name`. `Anonymous` for anonymous gifts and cheers. |
| `amount` | The main number: bits, gifted subs, raid viewers, points cost, donation amount and so on. |
| `currency` | Currency code for charity donations, such as `USD`. |
| `tier` | Sub tier: `1`, `2` or `3`. Prime subs are tier 1 with `data.is_prime` set to true. |
| `months` | Total months subscribed (subs and resubs). |
| `message` | The text the viewer typed, trimmed. Empty when there is none. |
| `message_parts` | The message split into text, emotes, cheermotes and mentions. Used by chat overlays. |
| `roles.broadcaster`, `roles.moderator`, `roles.vip`, `roles.subscriber` | The sender's chat roles. Only set for chat messages and for subs, resubs and gifts. `subscriber` is also true for founders. |
| `is_gift` | True for gifted subs, and for resubs of a gifted sub. |
| `is_anonymous` | True when the viewer hid their name. |
| `recipient.id`, `recipient.login`, `recipient.display_name` | Who received a gifted sub. |
| `recipient_name` | Shortcut for `recipient.display_name`. |
| `data` | Extra fields that depend on the kind. See [Kind-specific data](#kind-specific-data). |
| `test` | True for events made with a Test button. |

:::note
Kind-specific values live under `data`. Write `data.reward_title`, not `reward_title`, in [templates](/reference/templates/) and [conditions](/reference/conditions/).
:::

## Event kinds

"Alert" means the kind can have an on-screen alert. Every kind can trigger [automation](/reference/automation-steps/).

| Kind | Name in the app | Comes from Twitch | Alert |
| --- | --- | --- | --- |
| `follow` | Follow | `channel.follow` | Yes |
| `sub` | Subscription | Chat notice: new sub, or a gifted or Prime sub upgraded to a paid one | Yes |
| `resub` | Resubscription | Chat notice: resub | Yes |
| `gift_sub` | Gift sub | Chat notice: one gifted sub (also sent for each sub in a community gift) | Yes |
| `community_gift` | Community gift | Chat notice: a viewer gifts several subs to the community | Yes |
| `cheer` | Cheer (bits) | `channel.cheer` | Yes |
| `raid` | Raid | `channel.raid` (raids into your channel) | Yes |
| `redemption` | Channel points | `channel.channel_points_custom_reward_redemption.add` | Yes |
| `power_up` | Power-up | `channel.bits.use`, Power-ups only | Yes |
| `hype_train_begin` | Hype train starts | `channel.hype_train.begin` | Yes |
| `hype_train_progress` | Hype train progress | `channel.hype_train.progress` | No |
| `hype_train_end` | Hype train ends | `channel.hype_train.end` | Yes |
| `poll_begin` | Poll starts | `channel.poll.begin` | No |
| `poll_progress` | Poll progress | `channel.poll.progress` | No |
| `poll_end` | Poll ends | `channel.poll.end` | No |
| `prediction_begin` | Prediction starts | `channel.prediction.begin` | No |
| `prediction_progress` | Prediction progress | `channel.prediction.progress` | No |
| `prediction_lock` | Prediction locked | `channel.prediction.lock` | No |
| `prediction_end` | Prediction ends | `channel.prediction.end` | No |
| `shoutout_received` | Shoutout received | `channel.shoutout.receive` | Yes |
| `ad_break` | Ad break | `channel.ad_break.begin` | Yes |
| `charity` | Charity donation | `channel.charity_campaign.donate` | Yes |
| `stream_online` | Stream goes live | `stream.online` | No |
| `stream_offline` | Stream ends | `stream.offline` | No |
| `channel_update` | Title or category change | `channel.update` | No |
| `chat` | Chat message | `channel.chat.message` | No |
| `custom` | Custom | Made by the "Play alert" automation step, never by Twitch | Yes |

## Fields per kind

| Kind | `user` | `amount` | Other common fields |
| --- | --- | --- | --- |
| `follow` | The new follower | | |
| `sub` | The subscriber | | `tier`, `months` (always 1 for new subs), `message`, `roles` |
| `resub` | The subscriber | | `tier`, `months`, `message`, `roles`, `is_gift` |
| `gift_sub` | The gifter | | `tier`, `recipient`, `is_gift`, `is_anonymous`, `roles` |
| `community_gift` | The gifter | Number of subs gifted | `tier`, `is_gift`, `is_anonymous`, `roles` |
| `cheer` | The cheerer | Bits | `message`, `is_anonymous` |
| `raid` | The raiding channel | Viewers | |
| `redemption` | The viewer | Points cost | `message` (what the viewer typed, if the reward asks for text) |
| `power_up` | The viewer | Bits | `message` |
| `hype_train_*` | | Hype train total | |
| `shoutout_received` | The channel that shouted you out | Their viewer count | |
| `ad_break` | | Length in seconds | |
| `charity` | The donor | Amount, for example `5.5` | `currency` |
| `chat` | The chatter | | `message`, `message_parts`, `roles` |

Upgrades from a gifted sub arrive as `sub` without a tier. Upgrades from Prime arrive as `sub` with the new tier.

## Kind-specific data

Read these as `data.<key>`. Keys marked "if sent" only appear when Twitch includes them.

| Kind | `data` keys |
| --- | --- |
| `sub` | `is_prime`, `duration_months` (if sent), `system_message`, `upgrade` (`gift_paid_upgrade` or `prime_paid_upgrade`, upgrades only) |
| `resub` | `is_prime`, `duration_months` (if sent), `streak_months` (if the viewer shares it), `system_message` |
| `gift_sub` | `is_prime`, `duration_months` (if sent), `cumulative_total` (if sent), `community_gift_id` (when part of a community gift), `system_message` |
| `community_gift` | `is_prime`, `cumulative_total` (if sent), `community_gift_id`, `system_message` |
| `redemption` | `reward_title`, `reward_id`, `redemption_id`, `status` |
| `power_up` | `power_up_type`, `emote_name` (if sent) |
| `hype_train_begin`, `_progress`, `_end` | `hype_train_id`, `level`, `total`, `goal` and `progress` (if sent), `is_golden_kappa`, `top_contributions` |
| `poll_begin`, `_progress`, `_end` | `poll_id`, `title`, `choices`, `status`, `started_at`, `ends_at`, `ended_at` (times if sent) |
| `prediction_begin`, `_progress`, `_lock`, `_end` | `prediction_id`, `title`, `outcomes`, `status`, `winning_outcome_id` (if set), `started_at`, `locks_at`, `locked_at`, `ended_at` (times if sent) |
| `ad_break` | `is_automatic` |
| `charity` | `charity_name`, `campaign_id` |
| `stream_online` | `started_at`, `type` |
| `channel_update` | `title`, `category_name`, `category_id`, `language` |
| `chat` | `color`, `badges`, `message_type`, `reply_parent_message_id` (replies only), `cheer_bits` (cheers only), `reward_id` (messages sent with a channel point reward), `sent_by_castwright` (messages Castwright sent) |

All times in `data` are Unix timestamps in milliseconds.

### Lists inside `data`

| Key | Each item has |
| --- | --- |
| `top_contributions` | `name`, `login`, `type`, `total` |
| `choices` (polls) | `id`, `title`, `votes`, `bits_votes`, `channel_points_votes` |
| `outcomes` (predictions) | `id`, `title`, `color`, `users`, `channel_points` |
| `badges` (chat) | A badge name, such as `moderator` or `subscriber` |

Pick an item by its position, starting at 0: `data.choices.0.title` is the first poll choice.

### Status values

- Polls: `status` is Twitch's value, or `active` when Twitch sends none.
- Predictions: `status` is Twitch's value. When it's missing, it's `locked` for `prediction_lock` and `active` otherwise.

## Good to know

- Twitch sometimes sends the same notification twice. Castwright drops repeats by ID.
- With shared chat, messages and notices from the other channels are ignored.
- A community gift sends one `community_gift` event, then one `gift_sub` per sub. The `gift_sub` events carry `data.community_gift_id`. The "combine gifts" alert setting uses this to show one alert instead of many.
- Test events (`test: true`) go through alerts, overlays and actions like real ones, but don't change the [built-in variables](/reference/variables/).
- Chat messages are kept in memory only (the latest 200). Other events are saved to the event history.
