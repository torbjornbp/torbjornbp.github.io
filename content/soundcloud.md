---
title: "Mixtape backup"
---

<div id="app" style="height: 100vh">
  <!-- Webamp will attempt to center itself within this div -->
</div>

<script src="https://unpkg.com/webamp@1.5.0/built/webamp.bundle.min.js"></script>
<script src="https://unpkg.com/butterchurn@2.6.7/lib/butterchurn.min.js"></script>
<script src="https://unpkg.com/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js"></script>

<script>
    window.onload = async function() {
        await initWebamp();
    }

    async function initWebamp() {
        const Webamp = window.Webamp;
        const webamp = new Webamp({
            initialTracks: [
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "HOLMGANG 96",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/RM%20-%20HOLMGANG%2096.mp3",
                    duration: 3584,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Cherokee '93",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/RM%20-%20Cherokee%20'93.mp3",
                    duration: 3276,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Dance or Die!",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/RM%20-%20Dance%20or%20Die!.mp3",
                    duration: 3600,
                },
                {
                    metaData: {
                        artist: "Romskip",
                        title: "Fotarbeid",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Romskip%20-%20Fotarbeid.mp3",
                    duration: 3463,
                },
                {
                    metaData: {
                        artist: "Romskip",
                        title: "Boom Mix (uten intro)",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Romskip%20-%20Boom%20Mix%20(uten%20intro).mp3",
                    duration: 3335,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Godzilla 313",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Robot%20Monster%20-%20Godzilla%20313.mp3",
                    duration: 3529,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Elektro med K",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Robot%20Monster%20-%20Elektro%20med%20K.mp3",
                    duration: 2999,
                },
                {
                    metaData: {
                        artist: "Luca Canali",
                        title: "Trondheim Violenta",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Luca%20Canali%20-%20Trondheim%20Violenta.mp3",
                    duration: 3147,
                },
                {
                    metaData: {
                        artist: "Luca Canali",
                        title: "Un Robot tra i morti viventi",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Luca%20Canali%20-%20Un%20Robot%20tra%20i%20morti%20viventi.mp3",
                    duration: 1855,
                },
                {
                    metaData: {
                        artist: "Romskip",
                        title: "Minimix 050312",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Romskip%20-%20Minimix%20050312.mp3",
                    duration: 1324,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Robotron Live 28.06.14",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/RM%20@%20Robotron%2028.06.14.mp3",
                    duration: 3676,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Robotron Live 27.07.14",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/RM%20@%20Robotron%2027.07.14.mp3",
                    duration: 3190,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Robotron Live 04.07.14",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/RM%20@%20Robotron%2004.07.14.mp3",
                    duration: 3772,
                },
                {
                    metaData: {
                        artist: "Robot Monster",
                        title: "Mollenberg Mix 2009",
                    },
                    url: "https://filehost.s3.nl-ams.scw.cloud/mix/Robot.Monster.-.Mollenberg.Mix.2009.mp3",
                    duration: 3338,
                },
            ],
            __butterchurnOptions: {
                importButterchurn: () => Promise.resolve(window.butterchurn),
                getPresets: () => {
                    const presets = window.butterchurnPresets.getPresets();
                    return Object.keys(presets).map((name) => {
                        return {
                            name,
                            butterchurnPresetObject: presets[name],
                        };
                    });
                },
                butterchurnOpen: true,
            },
            windowLayout: {
                main: { position: { top: 0, left: 0 } },
                equalizer: { position: { top: 116, left: 0 } },
                playlist: {
                    position: { top: 232, left: 0 },
                    size: { extraWidth: 0, extraHeight: 4 },
                },
                milkdrop: {
                    position: { top: 0, left: 275 },
                    size: { extraHeight: 12, extraWidth: 7 },
                },
            },
        });

        // Remove any existing Webamp instances
        const oldWebamp = document.querySelector('#webamp');
        if (oldWebamp) {
            oldWebamp.remove();
        }

        await webamp.renderWhenReady(document.getElementById('app'));
    }
</script>

<style>
#app {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99999;
    pointer-events: none;
}

#app > div {
    pointer-events: auto;
}
</style>

{{< toc >}}

## Holmgang 96
Tracklist:
1. Public Domain - The Puritan (The Voice Mix)
2. El Bruto - Hardcore Motherfucker
3. Obliterator - Mind Twist
4. Dark Destination - Don´t Fuck With Me
5. Promo - Counter Attack
6. Ectomorph - Heartbeat
7. DJ Gizmo & The Darkraver - We Got The Juice (The Giz And Darkies 97 Mix)
8. Dj Alex - In Control (Climax Remix)
9. Omar Santana - Vitamin Oh
10. Party Animals - Used & Abused (Amnesia Mix)
11. Tschabos - Gib Mir Die Bass (Noch Korrekter)
12. Nitrogen - Bad Bwoy
13. Disintegrator - Dark Black Ominous Clouds
14. Tesox - Prophetic Steps
15. Mono Junk - Another Acid
16. Ilsa Gold - Up (Andi & Hoschi Mix 94)
17. Placid K - Good Luck
18. DJ Isaac - Let Da Beat
19. Predator - Filled With Power
20. DJ Seduction - Sample Mania
21. Too Fast For Mellow - Let There B House
22. Davie Forbes - Apocalypse Now
23. El Bruto - Braingeyser
24. Tellurian - Squash The Floor
25. Wayward - Hardcore Hijacked Me
26. Cray Emoticon - Choice Chip

## Cherokee '93
Extended 100 min cut available on tape + download here: rmtapes.bandcamp.com

MUSIC FOR CARS

SIDE A
1. THREE 6 MAFIA - FUCK WIT DIS CLICK
2. GIMISUM FAMILY - STRAPPED AT ALL TIMES
3. DA CRIME CLICK - LIFESTYLE OF A THUG
4. THREE 6 MAFIA - RIDIN' N DA CHEVY
5. TOMMY WRIGHT III - MURDER IN THE 1ST DEGREE
6. CRIMINAL E AND UNDERGROUND SAM - BREAKIN BAD
7. LIL FLY - BREAK DA LAW 93

SIDE B
1. LINNI - MAXIMUM
2. KINGPIN SKINNY PIMP - DON'T TEST ME
3. STREET MILITARY - NEVER LEAVE THA PAD
4. SKIMASK TROOPAZ - VIOLENCE
5. DJ SOUND - RIDGECREST KILLAZ
6. BLOODS AND CRIPS - STEADY DIPPIN
7. SKIMASK TROOPAZ - GET YO WIG SPLIT

## Dance or Die!
Tracklist:
1. Intro
2. Eruption - I Need Somebody
3. DJ Scholar - Simple Mane
4. Marshall Masters - Stereo Murder
5. DJ Sim - Cartoons in Progress
6. Kaptain Cadillac Feat. Six Foe - Booty Up, Booty Down (Leatherface Sirenia Remix)
7. DJ Hoodcore - Doomsday
8. Party Harders vs. The Subs - The Pope of Dope (DJ Kesmo Remix)
9. DJ Rolando - In Transit
10. Splack Pack - Let Me C Ya Work It
10. Oldschool Terrorists - Acieeed
11. Bodylotion - Make You Dance (Remix)
12. DJ Pnut - Get Down N Low
13. Omar Santana - How Shall I rock Thee
14. Slick Shoota - Candy Tool
15. Gesloten Cirkel - HH2
15. Arpeggiators - Discover Your Innerself
16. DJ Deeon & DJ Puff - The Baddest Bitch
17. Gladio - Calligula
18. DJ Assault - Terror Tec
19. Young Old - Fubu & Versace
20. Koopsta Knicca - Stash Pot
21. Tommy Wright III - Meet Your Maker
22. DJ Assault - Don't Try To Play Me
23. DJ Baba - Track #2
24. Public Domain - So Get Up
25. Dano - Best in the West (John Wayne Remix)
26. Angel - Take Me Away
26. DJ Yet - You
27. Sunshine Productions - Above the Clouds
28. DJ Godfather & Starski - Get Down
29. DJ Rashad & DJ Puncho - My Block
30. Robert Armani - Grind
31. Traxmen - F_____n Suckin
32. Alden Tyrell Feat. Mike Dunn - Touch the Sky (International House Mix)
33. Body Mechanic - Peacofmine
34. T-Pain - Fire (DJ Hoodcore Edit)
35. Boylan - Heavy Heavy
36. 2 Tech Mob - 313 Party
37. DJ Godfather - Bang the Box
38. Lexus Lovers - Beat of the Bass
39. Vibes & Wishdokta - Feels Good
40. DJ Isaac - Bad Dreams (Remix)
41. Sirenia

## Fotarbeid
Tracklist:
1. DJ Godfather - Scooby Snacks
2. DJ Godfather - Booty Perculate
3. Non Stop DJs - Rock The Nation
4. Coon Daddy - Big Baller
5. DJ Shortstep - Just Jit
6. Starski & Clutch - East to West
7. Waxmaster - Footwork
8. DJ Godfather - Download My Virus
9. DJ Phats - Bomb Ass Pussy
10. DJ Funk feat. Houz Mon - Work M/F
11. DJ Boogie - Rock Wild
12. DJ Surgeon - Track Called Killa
13. Coon Daddy - One Time on the Mic
14. DJ Godfather - I'm Everywhere
15. DJ Surgeon - Duel of the Jit
16. 313 Bass Mechanics - Throw Your Hands Up
17. DJ Godfather - Jaws
18. DJ Nasty - Cum Shot
19. Regulators feat. Dave Luxe - Casse Toi La Nuque (Leatherface Juke Mix)
20. Disco D - Work That
21. Goldilocks - Magic Carpet (Leatherface Remix)
22. DJ Nasty - Pop Wit It
23. DJ Godfather - Databass LIVE feat. Fletch flex
24. DJ Nasty - Blow Bubbles
25. DJ Nasty - Mayhem
26. DJ Funk - Hold Up
27. Mister Ries - Hit the Danceflo
28. DJ Phats - Tha Motes
29. Paul Blackford - Spy Wire
30. Claud' French - Anal Sexf eat. Noza & Veence Hanao
31. Leatherface - Murda
32. Slick Shoota - Puussyclot Funk Dem
33. Big Dope P - Kazfara Juke
34. Big Dope P - Trinaz Geto Trak
35. Chris Brown - Look At Me Now (Feat. Busta Rhymes & Lil Wayne)
36. DJ Godfather - No Ass No Pass
37. Non Stop DJs - Gotta Suck Dick
38. DJ Slugo - Godzilla (DJ Slugo Remix)
39. DJ TaMeiL - It's Me Bitches
40. DJ Assault - Bangappella
41. Waxmaster - Movelt Bounec Intro
42. Dj Deeon - Like We Do
43. Dj Deeon - Headhunters (Shake That Ass Mix)
44. DJ Omega - Spellbound
45. DJ Nasty - Lukewarm
46. Mister Ries - The Old Country
47. Starski & Clutch - Diamonds, Dollars, Ladies
48. Chrissy Murderbot - Thighs (DJ Guy's Cheatin' Mix)
49. DJ Omega - The SYmphony
50. Lecter - Draw Masta
51. Leatherface - The Real Nightmare
52. DJ Nasty - Sounds of the City
53. Leatherface - Bounce Drop
54. DJ Slugo - Big Booty Hoes