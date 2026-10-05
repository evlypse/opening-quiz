/*
 * LISTE DES ANIMES DU SITE
 * ------------------------
 * Chaque entrée :
 *   title   : le nom affiché dans la liste de recherche et dans la correction
 *   slug    : l'identifiant de l'anime sur https://animethemes.moe
 *             (la fin de l'URL, ex. https://animethemes.moe/anime/bleach -> "bleach")
 *   aliases : (optionnel) autres noms qu'on peut taper pour trouver l'anime
 *   query   : (optionnel) texte de recherche de secours si le slug est faux
 *             (par défaut, le slug avec des espaces à la place des "_")
 *
 * Si un slug est faux, le site essaie automatiquement de retrouver l'anime par
 * recherche. S'il n'y arrive pas, l'anime est ignoré pendant les parties et un
 * avertissement apparaît dans la console du navigateur (F12).
 *
 * Pour ajouter un anime : ajoute simplement une ligne ci-dessous.
 */
const ANIMES = [
  // ----- Shonen classiques -----
  { title: "Bleach", slug: "bleach" },
  { title: "Bleach: Thousand-Year Blood War", slug: "bleach_sennen_kessen_hen", aliases: ["Bleach TYBW"] },
  { title: "Naruto", slug: "naruto" },
  { title: "Naruto Shippuden", slug: "naruto_shippuuden", aliases: ["Naruto Shippuuden"] },
  { title: "Boruto: Naruto Next Generations", slug: "boruto_naruto_next_generations", aliases: ["Boruto"] },
  { title: "One Piece", slug: "one_piece" },
  { title: "Dragon Ball", slug: "dragon_ball" },
  { title: "Dragon Ball Z", slug: "dragon_ball_z", aliases: ["DBZ"] },
  { title: "Dragon Ball GT", slug: "dragon_ball_gt", aliases: ["DBGT"] },
  { title: "Dragon Ball Kai", slug: "dragon_ball_kai" },
  { title: "Dragon Ball Super", slug: "dragon_ball_super", aliases: ["DBS"] },
  { title: "Hunter x Hunter (2011)", slug: "hunter_x_hunter_2011", aliases: ["HxH"] },
  { title: "Fairy Tail", slug: "fairy_tail" },
  { title: "Black Clover", slug: "black_clover" },
  { title: "Yu Yu Hakusho", slug: "yuu_yuu_hakusho", aliases: ["Yuu Yuu Hakusho"] },
  { title: "Inuyasha", slug: "inuyasha" },
  { title: "Rurouni Kenshin", slug: "rurouni_kenshin", aliases: ["Kenshin le vagabond"] },
  { title: "Gintama", slug: "gintama" },
  { title: "Katekyo Hitman Reborn!", slug: "katekyoushi_hitman_reborn", aliases: ["Reborn"] },
  { title: "Soul Eater", slug: "soul_eater" },
  { title: "D.Gray-man", slug: "d_gray_man", aliases: ["D Gray man"] },
  { title: "Blue Exorcist", slug: "ao_no_exorcist", aliases: ["Ao no Exorcist"] },
  { title: "The Seven Deadly Sins", slug: "nanatsu_no_taizai", aliases: ["Nanatsu no Taizai"] },
  { title: "Magi: The Labyrinth of Magic", slug: "magi_the_labyrinth_of_magic", aliases: ["Magi"] },
  { title: "Fire Force", slug: "enen_no_shouboutai", aliases: ["Enen no Shouboutai"] },
  { title: "Mashle", slug: "mashle", aliases: ["Mashle: Magic and Muscles"] },
  { title: "Shaman King", slug: "shaman_king_2021", aliases: ["Shaman King (2021)"] },
  { title: "Pokémon", slug: "pokemon", aliases: ["Pokemon"] },
  { title: "Digimon Adventure", slug: "digimon_adventure" },
  { title: "Yu-Gi-Oh! Duel Monsters", slug: "yuu_gi_ou_duel_monsters", aliases: ["Yu-Gi-Oh", "Yugioh"] },
  { title: "Detective Conan", slug: "meitantei_conan", aliases: ["Case Closed", "Meitantei Conan"] },

  // ----- Shonen récents -----
  { title: "Attack on Titan", slug: "shingeki_no_kyojin", aliases: ["Shingeki no Kyojin", "L'Attaque des Titans", "SNK"] },
  { title: "Demon Slayer", slug: "kimetsu_no_yaiba", aliases: ["Kimetsu no Yaiba"] },
  { title: "Jujutsu Kaisen", slug: "jujutsu_kaisen", aliases: ["JJK"] },
  { title: "My Hero Academia", slug: "boku_no_hero_academia", aliases: ["Boku no Hero Academia", "MHA"] },
  { title: "Tokyo Ghoul", slug: "tokyo_ghoul" },
  { title: "Chainsaw Man", slug: "chainsaw_man" },
  { title: "Spy x Family", slug: "spy_x_family" },
  { title: "Mob Psycho 100", slug: "mob_psycho_100" },
  { title: "One Punch Man", slug: "one_punch_man", aliases: ["OPM"] },
  { title: "Dr. Stone", slug: "dr_stone", aliases: ["Dr Stone"] },
  { title: "The Promised Neverland", slug: "yakusoku_no_neverland", aliases: ["Yakusoku no Neverland"] },
  { title: "Tokyo Revengers", slug: "tokyo_revengers" },
  { title: "Dandadan", slug: "dandadan" },
  { title: "Hell's Paradise", slug: "jigokuraku", aliases: ["Jigokuraku"] },
  { title: "Kaiju No. 8", slug: "kaijuu_8_gou", aliases: ["Kaiju No 8", "Kaijuu 8 gou"] },
  { title: "Sakamoto Days", slug: "sakamoto_days" },
  { title: "Wind Breaker", slug: "wind_breaker" },
  { title: "Blue Lock", slug: "blue_lock" },
  { title: "Zom 100: Bucket List of the Dead", slug: "zom_100_zombie_ni_naru_made_ni_shitai_100_no_koto", aliases: ["Zom 100"] },
  { title: "Solo Leveling", slug: "ore_dake_level_up_na_ken", aliases: ["Ore dake Level Up na Ken"] },
  { title: "Frieren: Beyond Journey's End", slug: "sousou_no_frieren", aliases: ["Sousou no Frieren", "Frieren"] },
  { title: "Dungeon Meshi", slug: "dungeon_meshi", aliases: ["Delicious in Dungeon"] },
  { title: "Vinland Saga", slug: "vinland_saga" },
  { title: "Kingdom", slug: "kingdom" },
  { title: "Golden Kamuy", slug: "golden_kamuy" },
  { title: "Black Lagoon", slug: "black_lagoon" },
  { title: "Akame ga Kill!", slug: "akame_ga_kill", aliases: ["Akame ga Kill"] },
  { title: "Assassination Classroom", slug: "ansatsu_kyoushitsu", aliases: ["Ansatsu Kyoushitsu"] },
  { title: "JoJo's Bizarre Adventure", slug: "jojo_no_kimyou_na_bouken_2012", aliases: ["JoJo", "Jojo no Kimyou na Bouken"], query: "jojo no kimyou na bouken" },

  // ----- Classiques / culte -----
  { title: "Death Note", slug: "death_note" },
  { title: "Fullmetal Alchemist", slug: "fullmetal_alchemist", aliases: ["FMA"] },
  { title: "Fullmetal Alchemist: Brotherhood", slug: "fullmetal_alchemist_brotherhood", aliases: ["FMAB"] },
  { title: "Cowboy Bebop", slug: "cowboy_bebop" },
  { title: "Neon Genesis Evangelion", slug: "neon_genesis_evangelion", aliases: ["Evangelion"] },
  { title: "Code Geass: Lelouch of the Rebellion", slug: "code_geass_hangyaku_no_lelouch", aliases: ["Code Geass"] },
  { title: "Steins;Gate", slug: "steins_gate", aliases: ["Steins Gate"] },
  { title: "Samurai Champloo", slug: "samurai_champloo" },
  { title: "Trigun", slug: "trigun" },
  { title: "Trigun Stampede", slug: "trigun_stampede" },
  { title: "Berserk", slug: "berserk" },
  { title: "Hellsing Ultimate", slug: "hellsing_ultimate", aliases: ["Hellsing"] },
  { title: "Monster", slug: "monster" },
  { title: "Gurren Lagann", slug: "tengen_toppa_gurren_lagann", aliases: ["Tengen Toppa Gurren Lagann"] },
  { title: "Kill la Kill", slug: "kill_la_kill" },
  { title: "Eureka Seven", slug: "koukyoushihen_eureka_seven", aliases: ["Koukyoushihen Eureka Seven"] },
  { title: "Claymore", slug: "claymore" },
  { title: "Elfen Lied", slug: "elfen_lied" },
  { title: "Deadman Wonderland", slug: "deadman_wonderland" },
  { title: "Parasyte: The Maxim", slug: "kiseijuu_sei_no_kakuritsu", aliases: ["Kiseijuu", "Parasyte"] },
  { title: "Psycho-Pass", slug: "psycho_pass", aliases: ["Psycho Pass"] },
  { title: "Fate/Zero", slug: "fate_zero", aliases: ["Fate Zero"] },
  { title: "Fate/stay night: Unlimited Blade Works", slug: "fate_stay_night_unlimited_blade_works_2014", aliases: ["Fate stay night UBW"], query: "fate stay night unlimited blade works" },
  { title: "Black Butler", slug: "kuroshitsuji", aliases: ["Kuroshitsuji"] },
  { title: "Bakemonogatari", slug: "bakemonogatari" },
  { title: "Mahou Shoujo Madoka Magica", slug: "mahou_shoujo_madoka_magica", aliases: ["Madoka Magica", "Madoka"] },
  { title: "The Melancholy of Haruhi Suzumiya", slug: "suzumiya_haruhi_no_yuuutsu", aliases: ["Haruhi Suzumiya"] },
  { title: "Another", slug: "another" },
  { title: "Higurashi: When They Cry", slug: "higurashi_no_naku_koro_ni", aliases: ["Higurashi no Naku Koro ni"] },
  { title: "Death Parade", slug: "death_parade" },
  { title: "Erased", slug: "boku_dake_ga_inai_machi", aliases: ["Boku dake ga Inai Machi"] },
  { title: "Ghost in the Shell: Stand Alone Complex", slug: "koukaku_kidoutai_stand_alone_complex", aliases: ["Ghost in the Shell"] },
  { title: "Initial D", slug: "initial_d_first_stage", aliases: ["Initial D First Stage"] },

  // ----- Isekai / fantasy -----
  { title: "Sword Art Online", slug: "sword_art_online", aliases: ["SAO"] },
  { title: "Re:Zero", slug: "re_zero_kara_hajimeru_isekai_seikatsu", aliases: ["Re Zero kara Hajimeru Isekai Seikatsu"] },
  { title: "KonoSuba", slug: "kono_subarashii_sekai_ni_shukufuku_wo", aliases: ["Kono Subarashii Sekai ni Shukufuku wo"] },
  { title: "No Game No Life", slug: "no_game_no_life" },
  { title: "Overlord", slug: "overlord" },
  { title: "That Time I Got Reincarnated as a Slime", slug: "tensei_shitara_slime_datta_ken", aliases: ["Tensura", "Tensei shitara Slime Datta Ken"] },
  { title: "Mushoku Tensei", slug: "mushoku_tensei_isekai_ittara_honki_dasu", aliases: ["Mushoku Tensei: Jobless Reincarnation"] },
  { title: "The Rising of the Shield Hero", slug: "tate_no_yuusha_no_nariagari", aliases: ["Tate no Yuusha no Nariagari", "Shield Hero"] },
  { title: "DanMachi", slug: "dungeon_ni_deai_wo_motomeru_no_wa_machigatteiru_darou_ka", aliases: ["Is It Wrong to Try to Pick Up Girls in a Dungeon?"] },
  { title: "Log Horizon", slug: "log_horizon" },
  { title: "The Eminence in Shadow", slug: "kage_no_jitsuryokusha_ni_naritakute", aliases: ["Kage no Jitsuryokusha ni Naritakute"] },
  { title: "Seraph of the End", slug: "owari_no_seraph", aliases: ["Owari no Seraph"] },
  { title: "Noragami", slug: "noragami" },
  { title: "Made in Abyss", slug: "made_in_abyss" },
  { title: "Dororo", slug: "dororo" },
  { title: "Ranking of Kings", slug: "ousama_ranking", aliases: ["Ousama Ranking"] },
  { title: "Tower of God", slug: "kami_no_tou", aliases: ["Kami no Tou"] },
  { title: "The God of High School", slug: "god_of_high_school" },
  { title: "Aldnoah.Zero", slug: "aldnoah_zero", aliases: ["Aldnoah Zero"] },
  { title: "Darling in the Franxx", slug: "darling_in_the_franxx", aliases: ["DARLING in the FRANXX"] },
  { title: "Cyberpunk: Edgerunners", slug: "cyberpunk_edgerunners" },
  { title: "Toaru Majutsu no Index", slug: "toaru_majutsu_no_index", aliases: ["A Certain Magical Index"] },
  { title: "Toaru Kagaku no Railgun", slug: "toaru_kagaku_no_railgun", aliases: ["A Certain Scientific Railgun", "Railgun"] },
  { title: "Date A Live", slug: "date_a_live" },
  { title: "Little Witch Academia", slug: "little_witch_academia_tv" },

  // ----- Sport -----
  { title: "Haikyu!!", slug: "haikyuu", aliases: ["Haikyuu"] },
  { title: "Kuroko's Basketball", slug: "kuroko_no_basket", aliases: ["Kuroko no Basket"] },
  { title: "Slam Dunk", slug: "slam_dunk" },
  { title: "Hajime no Ippo", slug: "hajime_no_ippo" },
  { title: "Ace of Diamond", slug: "diamond_no_ace", aliases: ["Diamond no Ace"] },
  { title: "Yowamushi Pedal", slug: "yowamushi_pedal" },
  { title: "Free!", slug: "free" },
  { title: "The Prince of Tennis", slug: "tennis_no_oujisama", aliases: ["Tennis no Oujisama"] },
  { title: "Yuri!!! on Ice", slug: "yuri_on_ice", aliases: ["Yuri on Ice"] },
  { title: "SK8 the Infinity", slug: "sk8_the_infinity", aliases: ["SK8"] },

  // ----- Romance / slice of life / musique -----
  { title: "Toradora!", slug: "toradora", aliases: ["Toradora"] },
  { title: "Clannad", slug: "clannad" },
  { title: "Your Lie in April", slug: "shigatsu_wa_kimi_no_uso", aliases: ["Shigatsu wa Kimi no Uso"] },
  { title: "Angel Beats!", slug: "angel_beats", aliases: ["Angel Beats"] },
  { title: "Anohana", slug: "ano_hi_mita_hana_no_namae_wo_bokutachi_wa_mada_shiranai", aliases: ["Ano Hi Mita Hana no Namae wo Bokutachi wa Mada Shiranai"] },
  { title: "Kaguya-sama: Love Is War", slug: "kaguya_sama_wa_kokurasetai_tensai_tachi_no_renai_zunousen", aliases: ["Kaguya-sama wa Kokurasetai", "Kaguya sama"] },
  { title: "Horimiya", slug: "horimiya" },
  { title: "My Dress-Up Darling", slug: "sono_bisque_doll_wa_koi_wo_suru", aliases: ["Sono Bisque Doll wa Koi wo Suru"] },
  { title: "Komi Can't Communicate", slug: "komi_san_wa_komyushou_desu", aliases: ["Komi-san wa Komyushou desu"] },
  { title: "Rascal Does Not Dream of Bunny Girl Senpai", slug: "seishun_buta_yarou_wa_bunny_girl_senpai_no_yume_wo_minai", aliases: ["Bunny Girl Senpai"] },
  { title: "Classroom of the Elite", slug: "youkoso_jitsuryoku_shijou_shugi_no_kyoushitsu_e", aliases: ["Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e"] },
  { title: "Kakegurui", slug: "kakegurui" },
  { title: "Hyouka", slug: "hyouka" },
  { title: "Violet Evergarden", slug: "violet_evergarden" },
  { title: "Oshi no Ko", slug: "oshi_no_ko", aliases: ["[Oshi no Ko]"] },
  { title: "Bocchi the Rock!", slug: "bocchi_the_rock", aliases: ["Bocchi"] },
  { title: "K-On!", slug: "k_on", aliases: ["K-On"] },
  { title: "Lucky Star", slug: "lucky_star" },
  { title: "Lycoris Recoil", slug: "lycoris_recoil" },
  { title: "Nana", slug: "nana" },
  { title: "Ouran High School Host Club", slug: "ouran_koukou_host_club", aliases: ["Ouran Koukou Host Club"] },
  { title: "Fruits Basket (2019)", slug: "fruits_basket_2019", aliases: ["Fruits Basket"] },
  { title: "Banana Fish", slug: "banana_fish" },
  { title: "The Apothecary Diaries", slug: "kusuriya_no_hitorigoto", aliases: ["Kusuriya no Hitorigoto"] },
  { title: "Cells at Work!", slug: "hataraku_saibou", aliases: ["Hataraku Saibou"] },
  { title: "Food Wars!", slug: "shokugeki_no_souma", aliases: ["Shokugeki no Souma"] }
];

/*
 * DIFFICULTÉS
 * -----------
 * - FACILE    : les animes dont le slug est dans la liste ci-dessous (les plus connus)
 * - MOYEN     : tous les autres animes de la liste ANIMES plus haut
 * - DIFFICILE : tout le reste du catalogue AnimeThemes (des milliers d'openings)
 *
 * Pour rendre un anime plus facile ou plus difficile, ajoute ou retire son slug ici.
 */
const EASY_SLUGS = [
  "bleach", "bleach_sennen_kessen_hen", "naruto", "naruto_shippuuden", "boruto_naruto_next_generations",
  "one_piece", "dragon_ball", "dragon_ball_z", "dragon_ball_super", "hunter_x_hunter_2011",
  "death_note", "fullmetal_alchemist_brotherhood", "shingeki_no_kyojin", "kimetsu_no_yaiba",
  "jujutsu_kaisen", "boku_no_hero_academia", "sword_art_online", "tokyo_ghoul", "one_punch_man",
  "fairy_tail", "black_clover", "code_geass_hangyaku_no_lelouch", "cowboy_bebop",
  "neon_genesis_evangelion", "steins_gate", "haikyuu", "chainsaw_man", "spy_x_family",
  "mob_psycho_100", "re_zero_kara_hajimeru_isekai_seikatsu", "kono_subarashii_sekai_ni_shukufuku_wo",
  "dr_stone", "yakusoku_no_neverland", "tokyo_revengers", "oshi_no_ko", "bocchi_the_rock",
  "sousou_no_frieren", "ore_dake_level_up_na_ken", "dandadan", "pokemon", "digimon_adventure",
  "meitantei_conan", "jojo_no_kimyou_na_bouken_2012", "yuu_gi_ou_duel_monsters", "inuyasha",
  "gintama", "blue_lock", "vinland_saga", "no_game_no_life", "tensei_shitara_slime_datta_ken",
  "mushoku_tensei_isekai_ittara_honki_dasu", "cyberpunk_edgerunners", "toradora", "yuu_yuu_hakusho",
  "kaguya_sama_wa_kokurasetai_tensai_tachi_no_renai_zunousen", "hajime_no_ippo", "slam_dunk"
];
