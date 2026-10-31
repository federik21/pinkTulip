import { useEffect } from 'react';

export function SiteFooter() {
 return <footer className="site-footer">
  <span>BRW BATTLES · Independent fan-made prototype · 2–4 mages</span>
  <nav aria-label="About and legal">
   <a href="/about">About</a>
   <a href="/terms">Terms</a>
   <a href="/privacy">Privacy</a>
  </nav>
 </footer>;
}

export function LegalPage({ page }: { page: 'about' | 'terms' | 'privacy' }) {
 const title = page === 'about' ? 'About BRW Battles' : page === 'terms' ? 'Terms of Use' : 'Privacy Policy';
 useEffect(() => {
  document.title = `${title} · BRW Battles`;
  return () => { document.title = 'BRW Battles'; };
 }, [title]);

 return <div className="legal-shell">
  <header className="legal-header">
   <a className="brand" href="/">✺ <span>BRW BATTLES <small>ONLINE LODGE</small></span></a>
   <a href="/">Back to the game</a>
  </header>
  <main className="legal-page">
   <span className="eyebrow">BRW Battles</span>
   <h1>{title}</h1>
   {page === 'about' && <>
    <p className="legal-lead">A free, browser-based way to play an online battle with friends or AI opponents.</p>
    <h2>About the game</h2>
    <p>BRW Battles is an online prototype for 2–4 mages. Play together in a shared room or try a solo game with basic AI opponents. The game runs in your browser and does not require an account or a download.</p>
    <p>The prototype is free to use. It has no ads, paid features, or paid subscriptions.</p>
    <h2>Ownership and affiliation</h2>
    <p>BRW Battles is a name created for this independent, fan-made prototype. It is not owned, operated, or endorsed by Ludus Magnus Studio, and is not an official product. Ludus Magnus Studio holds the rights to Black Rose Wars: Rebirth and the games in the Nova Aetas universe.</p>
    <p>Some components of this prototype are original; others reproduce or adapt content from those games. All rights to third-party source material remain with their respective rights holders.</p>
   </>}
   {page === 'terms' && <>
    <p className="legal-lead">These terms apply when you access or use BRW Battles.</p>
    <h2>Using the service</h2>
    <p>BRW Battles is provided free of charge as an online game prototype. No paid subscriptions or purchases are offered. You may use it for personal, non-commercial play, subject to these terms and applicable law.</p>
    <p>Do not use the service to disrupt its operation, interfere with another player's experience, attempt unauthorized access, or use it for unlawful purposes. Room creators are responsible for sharing room names and any optional room passwords only with people they intend to invite.</p>
    <h2>Ownership</h2>
    <p>BRW Battles is an independent fan-made prototype, not owned or operated by Ludus Magnus Studio. Ludus Magnus Studio holds the rights to Black Rose Wars: Rebirth and the games in the Nova Aetas universe. Some components here are original and others reproduce or adapt material from those games. Rights in all third-party names, marks, artwork, text, and other source material remain with their respective rights holders; these terms do not grant you rights to that material.</p>
    <h2>Availability and disclaimer</h2>
    <p>The service is a prototype and may change, be interrupted, or become unavailable. Game rooms and saved sessions may be reset or removed. The service is provided “as is” and, to the extent permitted by law, without warranties of uninterrupted availability or fitness for a particular purpose.</p>
    <p>To the extent permitted by law, the person operating this prototype is not liable for indirect or consequential loss arising from use of, or inability to use, the service. Nothing in these terms limits rights that cannot be limited under applicable law.</p>
    <h2>Changes</h2>
    <p>These terms may be updated as the service changes. Continued use after an update means you accept the revised terms.</p>
   </>}
   {page === 'privacy' && <>
    <p className="legal-lead">This policy explains what information is used to run BRW Battles.</p>
    <h2>Information used in a game</h2>
    <p>You do not need an account. When you join a room, the service processes the mage name and room name you enter, an optional room password, and the game actions and state needed to run the room. Other people in your room can see your mage name and the game information shared with players.</p>
    <p>Room passwords are checked using a one-way password verifier rather than being stored as readable passwords. A private reconnect token is stored in your browser's local storage so you can reclaim your mage seat from that browser. The “Slow AI” preference is also stored locally. You can clear these values by clearing this site's browser storage; clearing the reconnect token can prevent you from reclaiming a seat.</p>
    <h2>Room retention</h2>
    <p>Game data is held by the game server while a room is active. Depending on the server's configuration, an unfinished battle may also be saved on that server so players can resume later. The server operator controls whether saving is enabled and how long saved data is kept.</p>
    <h2>Third-party services</h2>
    <p>The site loads its typefaces from Google Fonts. Your browser makes a request to Google to retrieve those fonts, and Google may receive technical information associated with that request under its own privacy terms. BRW Battles does not offer paid subscriptions, show advertisements, or use account-based advertising profiles.</p>
    <h2>Your choices and questions</h2>
    <p>You can choose your mage and room names and whether to set an optional room password. Clearing browser storage removes the locally stored preference and reconnect token. For questions about information held by the game server, contact the person operating that server.</p>
   </>}
  </main>
  <SiteFooter/>
 </div>;
}
