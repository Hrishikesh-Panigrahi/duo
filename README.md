# Duo

A private little app for two people: one shared contact book, a chat, shared lists and notes.
It's an installable web app (PWA): open it on your phones, "Add to Home Screen", and it behaves like a normal app.

- **Contacts**: one book for both of you, with search, tags, favourites, birthdays and notes. Call, text, WhatsApp or email in one tap.
  Save any contact into your phone's own contacts (.vcf), share it, or show a QR code anyone can scan.
  Import from your phone (Android) or a .vcf export (iPhone, Google Contacts).
- **Chat**: realtime messages, "typing…" and online status, unread badge. Send a contact card to the other person,
  who can save it to their phone in one tap. Long-press a message to copy it, save it as a note, or delete it.
- **View-once photos and videos**: opened once, then deleted. If you're both in the app, they go straight from one
  phone to the other and are never stored anywhere else. If not, they wait (encrypted) for up to 3 days, then are
  deleted unopened. Videos can be up to 45 MB; photos are shrunk on the phone before sending.
- **Lists**: shared checklists with due dates. **Coming up** shows birthdays from your contacts and anything due soon.
- **Notes**: shared notes that save as you type; pin the important ones.

Built with React + Vite + Tailwind, and [Supabase](https://supabase.com) for the database, login, file storage and
realtime sync.

**Everything is end-to-end encrypted.** The two of you pick a passphrase together and enter it once per device; it
never leaves your phones. Messages, photos and videos, contacts, notes, lists, and even your names and the space's
name are encrypted on the phone (AES-256-GCM, key derived with PBKDF2), so the server stores only ciphertext.
Row-level security also means only the two people in a space can fetch even that. What the server can still see:
your login emails, that you share a space, when things are added or changed, and rough sizes. If you both forget the
passphrase, the space can't be decrypted by anyone.

Beyond the encryption:

- **Direct transfers** use WebRTC (itself encrypted with DTLS) on top of the end-to-end encryption, and the messages
  that set them up are sealed with your key and refused if they're more than 2 minutes old, so nobody can join in,
  pose as one of your phones, or replay an old connection. The only outside server involved is Cloudflare's STUN
  server, which tells each phone its public address; there's no relay, so a file goes phone to phone or not at all.
- **The live room** (who's online, typing, setting up transfers) is a private Realtime channel that only the two
  members of a space may join, listen to or send on.
- **Once a space is encrypted, nothing unencrypted is ever shown or trusted.** A row without ciphertext could only
  have been written by someone with database access, so the app ignores it.
- **Browser-enforced rules** (a content security policy and related headers, in `dist/_headers`) only let the app run
  its own code and talk to its own Supabase project, and stop other sites framing it.
- **Errors never show database details**, the encryption key can't be exported even by the app, nothing you share is
  kept in the offline cache, and the build ships no source maps.

What it can't protect against: a screenshot or another camera, someone using your unlocked phone, a weak passphrase
(the app refuses obvious ones and can suggest a strong one), or someone who takes over your Supabase, Cloudflare or
GitHub account and changes the app's code. Turn on two-factor sign-in for all three.

## Run it locally

You need Node 20+ and Docker (for a local Supabase).

```bash
npm install
npx supabase start          # local Postgres, auth, API and realtime; applies supabase/migrations
npx supabase status -o env  # copy API_URL and PUBLISHABLE_KEY from here
cp .env.example .env.local  # paste them in as VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

To try it as two people on one computer, use two different origins (they keep separate logins), e.g.
<http://localhost:5173> and <http://you.localhost:5173>.

`npm test` runs the unit tests (encryption, passphrases, direct-transfer framing, error messages, vCard
import/export, birthday maths, media limits). `npm run build && npm run preview` serves the production build with
its real security headers.
`npx supabase stop` shuts the local stack down.

## Put it online

1. **Database.** Create a free project at [supabase.com](https://supabase.com). In its SQL editor, run every file in
   [`supabase/migrations/`](supabase/migrations/) **in filename order**. They also create the private `media` bucket
   for photos and videos.
2. **Auth settings** (Authentication → Sign In / Providers, and URL Configuration):
   - Set **Site URL** to wherever you'll host the app (step 3), so confirmation and password-reset links come back to it.
   - Optional: turn off **Confirm email** so you can sign up without the email round-trip.
3. **App.** `npm run build` produces a static site in `dist/`. Host it on any static host with HTTPS
   (Cloudflare Pages, Netlify, Vercel, GitHub Pages). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
   as build-time environment variables there. HTTPS is required for installing it as an app.
4. **Join.** One of you signs up, taps *Start our space*, and picks the shared passphrase; the app then offers an
   invite link (and the code inside it). The other opens the link, signs up, and is in the space straight away; then
   they enter the passphrase you've told them in person. The link carries only the code, after the `#` so it never
   reaches a server, and it stops working once the second person is in.
5. **Lock it down.** Once you've both joined, turn off **Allow new users to sign up** in Supabase. Strangers
   couldn't see your data anyway, but there's no reason to let anyone create accounts. Also turn on two-factor
   sign-in for your Supabase, Cloudflare and GitHub accounts: whoever controls those controls the app's code.

### Hosting it yourself instead (e.g. an Oracle Cloud free VM)

The app doesn't care where Supabase runs. The same migration works on a
[self-hosted Supabase](https://supabase.com/docs/guides/self-hosting/docker) (Docker Compose), and `dist/` can be
served from the same box behind Caddy or nginx with a TLS certificate. Trade-offs vs. the hosted free tier:

- **You're the ops team:** OS and Supabase updates, TLS renewal, Postgres backups, keeping the dashboard off the
  public internet, and an SMTP server if you want password-reset emails.
- **You need a domain** (a free DuckDNS-style name works) for HTTPS, which the installable app requires.
- **Oracle reclaims idle Always Free VMs.** Check their current policy; a two-person app sits mostly idle.
- In exchange: no project pausing, no 500 MB database cap, and your data lives on a machine you control.

### Free-plan limits worth knowing

- **Database: 500 MB.** Text is tiny, so that's well over a million messages. If it fills up, the database turns
  read-only; nothing is charged.
- **File storage: 1 GB, 50 MB per file.** Only photos and videos sent while the other person is away are stored,
  and they're deleted once opened or after 3 days, so this stays nearly empty.
- **Data transfer: 5 GB a month** (plus 5 GB cached). Photos barely count; large videos do.
- **Free projects pause after a week of no use**; resume them from the Supabase dashboard.

## How it's put together

```
supabase/migrations/   schema, row-level security, ciphertext-only rules, media bucket and its policies
src/lib/e2e.ts         key derivation and encryption; every ciphertext is bound to what it is and where it belongs
src/lib/store.tsx      a space's data for the screens (useSpace), wiring together the pieces in src/lib/space/:
  rows.ts                the rows as stored, and how they change
  sync.ts                loading them and keeping them live over Realtime
  device-key.ts          this device's key for the space
  plaintext.ts, view.ts  decrypting rows, and turning them into what the screens show
  room.ts                who's online and typing, and the sealed signalling for direct transfers
  store-actions.ts       RowWriter, the shared ways of writing encrypted rows, and the base class every action uses
  *-actions.ts           everything the screens can do, as useSpace().actions.chat / .contacts / .notes /
                         .lists / .names / .encryption
src/lib/contact-match.ts  finding a likely duplicate contact, and searching the contact book
src/lib/direct.ts      phone-to-phone delivery of photos and videos over WebRTC
src/lib/inbox.ts       where a directly delivered file waits, still encrypted, until it's opened
src/lib/media.ts       view-once photos and videos: shrinking, size limits, expiry
src/lib/passphrase.ts  refusing guessable passphrases, and suggesting strong ones
src/lib/vcard.ts       vCard 2.1/3.0/4.0 parsing and export
src/components/        shared UI pieces, the long-press menu, and useBusy for a form's save-and-report
src/features/          auth, space setup, settings, and each tab:
  chat.tsx, chat-media.tsx                       messages, and view-once photos and videos
  contacts.tsx, contact-detail/form/import.tsx   the contact book, one contact, editing, importing
  lists.tsx, list-view.tsx, list-form.tsx, coming-up.tsx
  notes.tsx
```

## Not built yet

- Push notifications when the app is closed (needs Web Push plus a small server function).
- Shrinking videos on the phone before sending (for now they're sent as recorded, up to 45 MB).
- Chat history beyond the latest 500 messages.
- Changing the passphrase (it would mean re-encrypting everything).
