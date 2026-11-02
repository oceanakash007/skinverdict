// SkinVerdict ingredient database.
// ACTIVES: what each helps (concern -> weight; 1 = primary use, 0.5 = supporting).
// WATCHOUTS: trigger only when the user's own scores show the related vulnerability.
// BASE: common functional ingredients (so we can show "recognised" coverage and explain each one).
// Cosmetic guidance based on widely used formulation conventions, not medical advice.
(function (root) {
  const A = (id, name, match, helps, extra = {}) => ({ id, name, match, helps, ...extra });

  const ACTIVES = [
    // --- Breakouts / pores / oil ---
    A("bha", "Salicylic acid (BHA)", /salicylic acid|\bbha\b|salix alba bark|willow bark/, { acne: 1, pore: 1, oiliness: 0.5, texture: 0.5 }, { strong: "exfoliant", note: "oil-soluble acid that unclogs pores" }),
    A("betaine-sal", "Betaine salicylate", /betaine salicylate/, { acne: 1, pore: 0.5, texture: 0.5 }, { note: "gentler BHA alternative" }),
    A("bpo", "Benzoyl peroxide", /benzoyl peroxide/, { acne: 1 }, { strong: "drying", note: "kills acne-causing bacteria" }),
    A("azelaic", "Azelaic acid", /azelaic acid|potassium azeloyl diglycinate|azeloyl/, { acne: 1, redness: 1, age_spot: 0.5 }, { note: "calms redness and breakouts" }),
    A("niacinamide", "Niacinamide (vitamin B3)", /niacinamide|nicotinamide/, { oiliness: 1, pore: 1, redness: 0.5, age_spot: 0.5, texture: 0.5, moisture: 0.5 }, { note: "balances oil, refines pores, strengthens the barrier" }),
    A("zinc", "Zinc", /zinc pca|zinc gluconate|zinc sulfate|zinc lactate/, { oiliness: 1, acne: 0.5 }, { note: "regulates sebum" }),
    A("sulfur", "Sulfur", /\bsulfur\b|\bsulphur\b/, { acne: 1, oiliness: 0.5 }, { strong: "drying", note: "absorbs oil, dries spots" }),
    A("teatree", "Tea tree oil", /melaleuca alternifolia|tea tree/, { acne: 0.5 }, { note: "mild antibacterial (can irritate)" }),
    A("clay", "Clay", /kaolin|bentonite|montmorillonite|illite/, { oiliness: 1, pore: 0.5 }, { note: "absorbs excess oil" }),
    A("propolis", "Propolis", /propolis/, { acne: 0.5, redness: 0.5 }, { note: "soothing, mildly antibacterial" }),
    A("lha", "Capryloyl salicylic acid (LHA)", /capryloyl salicylic acid/, { acne: 0.5, texture: 0.5, pore: 0.5 }, { note: "slow-release exfoliant" }),

    // --- Retinoids & anti-ageing ---
    A("retinol", "Retinol", /\bretinol\b/, { wrinkle: 1, texture: 1, age_spot: 0.5, acne: 0.5, pore: 0.5, firmness: 0.5 }, { strong: "retinoid", lowDoseOk: true, note: "boosts cell turnover and collagen" }),
    A("retinal", "Retinal (retinaldehyde)", /retinal\b|retinaldehyde/, { wrinkle: 1, texture: 1, acne: 0.5, age_spot: 0.5, firmness: 0.5 }, { strong: "retinoid", lowDoseOk: true, note: "fast-acting retinoid" }),
    A("hpr", "Granactive retinoid (HPR)", /hydroxypinacolone retinoate/, { wrinkle: 1, texture: 0.5, acne: 0.5 }, { lowDoseOk: true, note: "gentler retinoid ester" }),
    A("retinyl", "Retinyl esters", /retinyl palmitate|retinyl acetate|retinyl propionate|retinyl linoleate/, { wrinkle: 0.5, texture: 0.5 }, { lowDoseOk: true, note: "mild vitamin A derivative" }),
    A("adapalene", "Adapalene", /adapalene/, { acne: 1, texture: 1, pore: 0.5 }, { strong: "retinoid", lowDoseOk: true, note: "acne-focused retinoid" }),
    A("tretinoin", "Tretinoin", /tretinoin/, { wrinkle: 1, acne: 1, texture: 1, age_spot: 1 }, { strong: "retinoid", lowDoseOk: true, note: "prescription retinoid" }),
    A("bakuchiol", "Bakuchiol", /bakuchiol/, { wrinkle: 0.5, texture: 0.5, acne: 0.5 }, { note: "plant-based retinol alternative" }),
    A("peptides", "Signal peptides", /palmitoyl (tri|tetra|penta|hexa|oligo)peptide|palmitoyl dipeptide|matrixyl|tripeptide-1\b|pentapeptide/, { wrinkle: 0.5, firmness: 1 }, { lowDoseOk: true, note: "signal collagen production" }),
    A("argireline", "Argireline (acetyl hexapeptide-8)", /acetyl hexapeptide|argireline/, { wrinkle: 0.5 }, { lowDoseOk: true, note: "softens expression lines" }),
    A("copper", "Copper peptides", /copper tripeptide|ghk-cu|copper peptide/, { firmness: 1, wrinkle: 0.5, texture: 0.5 }, { lowDoseOk: true, note: "support repair and firmness" }),
    A("adenosine", "Adenosine", /\badenosine\b/, { wrinkle: 0.5, firmness: 0.5 }, { lowDoseOk: true, note: "smooths fine lines" }),
    A("coq10", "Coenzyme Q10", /ubiquinone|coenzyme q10/, { wrinkle: 0.5, radiance: 0.5 }, { note: "antioxidant" }),
    A("resveratrol", "Resveratrol", /resveratrol/, { radiance: 0.5, wrinkle: 0.5 }, { note: "antioxidant" }),
    A("ferulic", "Ferulic acid", /ferulic acid/, { radiance: 0.5 }, { note: "stabilises vitamin C, antioxidant" }),
    A("growth", "Ectoin", /\bectoin\b/, { redness: 1, moisture: 0.5 }, { note: "protects and calms stressed skin" }),

    // --- Exfoliating acids ---
    A("glycolic", "Glycolic acid (AHA)", /glycolic acid/, { texture: 1, radiance: 1, age_spot: 0.5, wrinkle: 0.5 }, { strong: "exfoliant", note: "smooths and brightens" }),
    A("lactic", "Lactic acid (AHA)", /lactic acid/, { texture: 1, radiance: 0.5, moisture: 0.5 }, { strong: "exfoliant", note: "gentle exfoliant that also hydrates" }),
    A("mandelic", "Mandelic acid (AHA)", /mandelic acid/, { texture: 1, acne: 0.5, age_spot: 0.5 }, { strong: "exfoliant", note: "slow, gentle exfoliant" }),
    A("citric-aha", "Other AHAs", /malic acid|tartaric acid|\baha\b/, { texture: 0.5 }, { strong: "exfoliant", note: "fruit acids" }),
    A("pha", "PHA (gluconolactone)", /gluconolactone|lactobionic acid|galactose/, { texture: 0.5, moisture: 0.5 }, { note: "very gentle exfoliant" }),
    A("enzymes", "Fruit enzymes", /papain|bromelain|papaya|subtilisin/, { texture: 0.5, radiance: 0.5 }, { note: "enzymatic exfoliation" }),

    // --- Brightening / spots ---
    A("vitc", "Vitamin C (L-ascorbic acid)", /\bascorbic acid\b/, { age_spot: 1, radiance: 1, wrinkle: 0.5 }, { note: "brightens and fades spots" }),
    A("vitc-deriv", "Vitamin C derivatives", /ascorbyl glucoside|sodium ascorbyl phosphate|magnesium ascorbyl phosphate|3-o-ethyl ascorb|ethyl ascorbic|tetrahexyldecyl ascorbate|ascorbyl tetraisopalmitate|ascorbyl palmitate/, { age_spot: 1, radiance: 1 }, { note: "stable, gentler vitamin C" }),
    A("tranexamic", "Tranexamic acid", /tranexamic acid/, { age_spot: 1, redness: 0.5 }, { note: "targets stubborn pigmentation" }),
    A("arbutin", "Alpha arbutin", /arbutin/, { age_spot: 1 }, { note: "fades dark spots" }),
    A("kojic", "Kojic acid", /kojic/, { age_spot: 1 }, { note: "brightener" }),
    A("licorice", "Licorice root", /glycyrrhiza|licorice|glabridin|dipotassium glycyrrhizate/, { age_spot: 0.5, redness: 0.5 }, { note: "brightens and soothes" }),
    A("hexylres", "Hexylresorcinol", /hexylresorcinol/, { age_spot: 1 }, { note: "brightener" }),
    A("cysteamine", "Cysteamine", /cysteamine/, { age_spot: 1 }, { note: "pigment corrector" }),
    A("spf", "Sunscreen filters", /zinc oxide|titanium dioxide|avobenzone|butyl methoxydibenzoylmethane|octinoxate|ethylhexyl methoxycinnamate|homosalate|octocrylene|octisalate|ethylhexyl salicylate|bis-ethylhexyloxyphenol|tinosorb|uvinul|diethylamino hydroxybenzoyl|ethylhexyl triazone|methylene bis-benzotriazolyl|drometrizole trisiloxane|terephthalylidene|ecamsule|\bpolysilicone-15/, { age_spot: 1, wrinkle: 0.5, redness: 0.5 }, { note: "prevents new spots and UV ageing" }),

    // --- Hydration & barrier ---
    A("ha", "Hyaluronic acid", /hyaluronic acid|sodium hyaluronate|hydrolyzed hyaluronic|hyaluronate/, { moisture: 1 }, { note: "holds water in skin" }),
    A("pga", "Polyglutamic acid", /polyglutamic acid|polyglutamate/, { moisture: 1 }, { note: "strong humectant" }),
    A("glycerin", "Glycerin", /\bglycerin\b|\bglycerol\b/, { moisture: 0.5 }, { note: "classic humectant" }),
    A("urea", "Urea", /\burea\b/, { moisture: 1, texture: 0.5 }, { note: "hydrates and softens rough skin" }),
    A("panthenol", "Panthenol (pro-vitamin B5)", /panthenol/, { moisture: 0.5, redness: 0.5 }, { note: "soothes and hydrates" }),
    A("napca", "Sodium PCA", /sodium pca/, { moisture: 0.5 }, { note: "natural moisturising factor" }),
    A("trehalose", "Trehalose / betaine", /trehalose|\bbetaine\b/, { moisture: 0.5 }, { note: "humectant" }),
    A("ceramides", "Ceramides", /ceramide/, { moisture: 1, redness: 0.5 }, { note: "repair the skin barrier" }),
    A("lipids", "Barrier lipids", /phytosphingosine|\bcholesterol\b|sphingolipid/, { moisture: 0.5, redness: 0.5 }, { note: "barrier support" }),
    A("squalane", "Squalane", /squalane/, { moisture: 1 }, { note: "lightweight, non-clogging emollient" }),
    A("snail", "Snail mucin", /snail secretion filtrate|snail mucin/, { moisture: 0.5, texture: 0.5 }, { note: "hydrating and repairing" }),
    A("beta-glucan", "Beta-glucan", /beta-glucan|\bglucan\b/, { moisture: 0.5, redness: 0.5 }, { note: "hydrates and calms" }),
    A("aloe", "Aloe vera", /aloe barbadensis|aloe vera/, { redness: 0.5, moisture: 0.5 }, { note: "soothing" }),

    // --- Soothing ---
    A("centella", "Centella asiatica (cica)", /centella asiatica|madecassoside|asiaticoside|madecassic acid|asiatic acid/, { redness: 1, texture: 0.5 }, { note: "calms irritation, supports repair" }),
    A("allantoin", "Allantoin", /allantoin/, { redness: 0.5, texture: 0.5 }, { note: "soothing" }),
    A("bisabolol", "Bisabolol", /bisabolol/, { redness: 1 }, { note: "chamomile-derived soother" }),
    A("greentea", "Green tea", /camellia sinensis|green tea|epigallocatechin/, { redness: 0.5, oiliness: 0.5 }, { note: "antioxidant, calming" }),
    A("oat", "Colloidal oatmeal", /avena sativa|colloidal oatmeal/, { redness: 1, moisture: 0.5 }, { note: "relieves irritation" }),
    A("mugwort", "Mugwort", /artemisia/, { redness: 0.5 }, { note: "soothing botanical" }),

    // --- Eyes ---
    A("caffeine", "Caffeine", /\bcaffeine\b/, { eye_bag: 1, dark_circle_v2: 0.5 }, { note: "de-puffs" }),
    A("vitk", "Vitamin K", /phytonadione|vitamin k\b/, { dark_circle_v2: 0.5 }, { note: "may reduce dark circles" }),
  ];

  const WATCHOUTS = [
    {
      id: "fragrance",
      name: "Added fragrance",
      match: /\bparfum\b|\bfragrance\b|perfume/,
      risk: { redness: "fragrance is the most common cause of reactions on sensitive, reddened skin", moisture: "fragrance can further irritate a weakened, dehydrated barrier" },
    },
    {
      id: "allergens",
      name: "Fragrance allergens",
      match: /\blimonene\b|\blinalool\b|\bcitral\b|\bgeraniol\b|\beugenol\b|\bcitronellol\b|\bcoumarin\b|hexyl cinnamal|benzyl salicylate|\bcinnamal\b|\bfarnesol\b|isoeugenol|amyl cinnamal|benzyl benzoate|alpha-isomethyl ionone/,
      risk: { redness: "a listed fragrance allergen; can trigger redness on reactive skin" },
    },
    {
      id: "essential-oils",
      name: "Essential oils",
      match: /lavandula|lavender oil|mentha piperita|peppermint|eucalyptus|citrus (limon|aurantium|bergamia|paradisi)|bergamot|lemon peel oil|orange peel oil|rosmarinus|cananga odorata|ylang|eugenia caryophyllus|clove oil|cinnamomum|melaleuca alternifolia|tea tree/,
      risk: { redness: "essential oils are potent and often irritating for sensitive skin", moisture: "essential oils can stress a dehydrated barrier" },
    },
    {
      id: "alcohol",
      name: "Drying alcohol",
      match: /alcohol denat|\bsd alcohol\b|denatured alcohol|\bethanol\b|isopropyl alcohol|^alcohol$/,
      risk: { moisture: "drying alcohol pulls water from already-dehydrated skin", redness: "drying alcohol can sting and worsen redness" },
    },
    {
      id: "sulfates",
      name: "Harsh sulfates",
      match: /sodium lauryl sulfate|ammonium lauryl sulfate|sodium c14-16 olefin sulfonate/,
      risk: { moisture: "strong detergents strip natural oils from dehydrated skin", redness: "harsh cleansers can aggravate redness" },
    },
    {
      id: "comedogenic",
      name: "Pore-clogging ingredients",
      match: /cocos nucifera|coconut oil|isopropyl myristate|isopropyl palmitate|isopropyl isostearate|isopropyl lanolate|theobroma cacao|cocoa butter|triticum vulgare|wheat germ oil|algae extract|laureth-4|myristyl myristate|acetylated lanolin|ethylhexyl palmitate|octyl palmitate|decyl oleate|isocetyl stearate|linseed oil|linum usitatissimum/,
      risk: { acne: "it is known to clog pores, and your breakout score is low", pore: "it can congest pores that already read as enlarged", oiliness: "a heavy, pore-clogging base on already oily skin" },
    },
    {
      id: "scrub",
      name: "Physical scrub particles",
      match: /walnut shell|juglans regia.*shell|prunus armeniaca.*seed powder|apricot seed|\bpumice\b|olea europaea.*seed powder/,
      risk: { redness: "jagged scrub particles cause micro-tears on reactive skin", acne: "scrubbing active breakouts can spread inflammation" },
    },
    {
      id: "cooling",
      name: "Menthol / camphor",
      match: /\bmenthol\b|\bcamphor\b|menthyl lactate/,
      risk: { redness: "the 'tingle' is irritation; best avoided when redness is high" },
    },
  ];

  // Common functional ingredients: [pattern, role]
  const BASE = [
    [/^(aqua|water|eau|purified water|aqua \/ water)$|^aqua\b/, "base: water"],
    [/butylene glycol|propanediol|pentylene glycol|propylene glycol|dipropylene glycol|methylpropanediol|1,2-hexanediol|hexylene glycol|caprylyl glycol|isopentyldiol|glycereth/, "solvent / humectant"],
    [/phenoxyethanol|ethylhexylglycerin|chlorphenesin|sodium benzoate|potassium sorbate|benzyl alcohol|dehydroacetic acid|sodium dehydroacetate|methylparaben|propylparaben|ethylparaben|butylparaben|benzoic acid|sorbic acid|caprylhydroxamic acid|methylisothiazolinone|dmdm hydantoin|imidazolidinyl urea|o-cymen-5-ol|polyaminopropyl biguanide|hydroxyacetophenone/, "preservative"],
    [/xanthan gum|carbomer|hydroxyethylcellulose|sclerotium gum|cellulose gum|gellan gum|tamarindus indica seed gum|acrylates|polyacrylate|polyacrylamide|acryloyldimethyltaurate|carrageenan|agar|pullulan|guar|silica|magnesium aluminum silicate|hectorite|bentonite/, "thickener / texture"],
    [/polysorbate|peg-\d|ceteareth|steareth|laureth(?!-4)|isoceteth|oleth|polyglyceryl|sorbitan|lecithin|glyceryl stearate|cetearyl glucoside|coco-glucoside|decyl glucoside|lauryl glucoside|arachidyl glucoside|sucrose|potassium cetyl phosphate|sodium stearoyl glutamate/, "emulsifier"],
    [/cetearyl alcohol|cetyl alcohol|stearyl alcohol|behenyl alcohol|myristyl alcohol|arachidyl alcohol|lauryl alcohol/, "fatty alcohol (not drying)"],
    [/dimethicone|cyclopentasiloxane|cyclohexasiloxane|cyclomethicone|siloxane|methicone|silsesquioxane|dimethiconol/, "silicone (smooth finish)"],
    [/caprylic\/capric triglyceride|caprylic capric triglyceride|isononyl isononanoate|c12-15 alkyl benzoate|coco-caprylate|isoamyl laurate|dicaprylyl carbonate|ethylhexyl stearate|cetyl ethylhexanoate|isohexadecane|isododecane|hydrogenated polyisobutene|diisopropyl adipate|neopentyl|propanediol dicaprylate|undecane|tridecane|hemisqualane/, "emollient"],
    [/butyrospermum parkii|shea butter|simmondsia chinensis|jojoba|argania spinosa|argan|helianthus annuus|sunflower|olea europaea|olive|prunus amygdalus|almond oil|rosa canina|rosehip|vitis vinifera|grape seed|persea gratissima|avocado|macadamia|camellia japonica|cera alba|beeswax|candelilla|carnauba|copernicia|mineral oil|paraffinum liquidum|petrolatum|lanolin|hydrogenated vegetable oil|ricinus communis|castor oil|oryza sativa|rice bran oil|squalene/, "oil / emollient"],
    [/tocopherol|tocopheryl acetate|vitamin e/, "antioxidant (vitamin E)"],
    [/disodium edta|tetrasodium edta|trisodium ethylenediamine disuccinate|sodium phytate|phytic acid|tetrasodium glutamate diacetate|sodium gluconate/, "chelator (stability)"],
    [/sodium citrate|citric acid|sodium hydroxide|potassium hydroxide|triethanolamine|tromethamine|aminomethyl propanol|arginine|lactic acid buffer|sodium lactate|sodium phosphate|disodium phosphate/, "pH adjuster"],
    [/sodium chloride|magnesium sulfate|sodium sulfate/, "salt (texture)"],
    [/mica|iron oxide|ci 77\d+|ci 19140|ci 42090|ci 15985|ci 17200|tin oxide|bismuth oxychloride/, "colourant"],
    [/cocamidopropyl betaine|sodium laureth sulfate|sodium cocoyl isethionate|sodium lauroyl sarcosinate|sodium cocoyl glutamate|disodium cocoyl glutamate|sodium methyl cocoyl taurate|sodium lauroamphoacetate|coco-betaine|potassium cocoate|sodium cocoate/, "cleansing agent"],
    [/polyquaternium|guar hydroxypropyltrimonium/, "conditioning agent"],
    [/dimethyl isosorbide|ethoxydiglycol|isosorbide/, "penetration solvent"],
    [/sorbitol|xylitol|xylitylglucoside|anhydroxylitol|glucose|fructose|honey|mel\b|saccharide isomerate|inulin/, "humectant / sugar"],
    [/amino acid|glycine|serine|alanine|proline|threonine|glutamic acid|lysine|hydrolyzed (collagen|silk|wheat|rice|soy|keratin)|collagen/, "skin-conditioning protein"],
    [/extract|leaf water|flower water|ferment/, "plant extract"],
    [/ethylhexyl|triethoxycaprylylsilane|alumina|aluminum hydroxide|stearic acid|palmitic acid|myristic acid|lauric acid|nylon|boron nitride|polymethyl methacrylate|polyethylene|kaolin/, "formulation aid"],
  ];

  // Typical cosmetic concentration ranges [min effective, upper typical] in %, from commonly published
  // formulation guidance. Flagged for expert review (see scripts/export-rules.js).
  const CONCENTRATIONS = {
    niacinamide: { name: "Niacinamide", re: /niacinamide/, range: [2, 10], highNote: "above 10% can cause flushing on sensitive skin" },
    "salicylic acid": { name: "Salicylic acid", re: /salicylic acid|\bbha\b/, range: [0.5, 2], highNote: "above 2% is unusually strong for leave-on use" },
    "glycolic acid": { name: "Glycolic acid", re: /glycolic acid/, range: [5, 10], highNote: "above 10% is a strong peel for home use" },
    "lactic acid": { name: "Lactic acid", re: /lactic acid/, range: [5, 10], highNote: "above 10% is strong" },
    "mandelic acid": { name: "Mandelic acid", re: /mandelic acid/, range: [5, 10], highNote: "above 10% is strong" },
    "azelaic acid": { name: "Azelaic acid", re: /azelaic acid/, range: [10, 20], highNote: "above 20% is prescription strength" },
    retinol: { name: "Retinol", re: /retinol/, range: [0.1, 1], highNote: "above 1% is very strong; build up slowly" },
    "ascorbic acid": { name: "Vitamin C (ascorbic acid)", re: /ascorbic acid|vitamin c/, range: [8, 20], highNote: "above 20% adds irritation without extra benefit" },
    "benzoyl peroxide": { name: "Benzoyl peroxide", re: /benzoyl peroxide/, range: [2.5, 5], highNote: "above 5% dries skin without clearly better results" },
    "tranexamic acid": { name: "Tranexamic acid", re: /tranexamic acid/, range: [2, 5], highNote: "above 5% is unusually high" },
    "alpha arbutin": { name: "Alpha arbutin", re: /arbutin/, range: [1, 2], highNote: "above 2% is above common guidance" },
    "zinc pca": { name: "Zinc PCA", re: /zinc/, range: [0.5, 1], highNote: "" },
  };

  const api = { ACTIVES, WATCHOUTS, BASE, CONCENTRATIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SkinIngredients = api;
})(typeof window !== "undefined" ? window : globalThis);
