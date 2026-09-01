const DKK = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" });

export const formatPrice = price => (price == null ? "ukendt pris" : DKK.format(price));

export function formatRelative(date) {
    if (!date) return "aldrig";
    const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60000);
    if (minutes < 1) return "lige nu";
    if (minutes < 60) return `${minutes} min. siden`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} timer siden`;
    return `${Math.round(hours / 24)} dage siden`;
}

export const dropPercent = (from, to) => Math.round(((from - to) / from) * 100);

// Discord afviser en embed-titel over 256 tegn, og Proshops navne på
// enkeltkort er nogle gange længere end det.
export function truncate(text, max) {
    if (!text) return "";
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
