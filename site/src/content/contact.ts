// Contact page content. Edit here; the page and form read from these.

export interface ContactLink {
  label: string;
  url: string;
}

export const NAME: string = "Alec Reimel";
export const AVAILABILITY: string = "Available for work in PA & NJ - Greater Philadelphia Area";
export const EMAIL: string = "alecreimel1@gmail.com";

// To add a microsite, add an entry here; the contact page lists it automatically.
export const LINKS: ContactLink[] = [
  { label: "Website", url: "https://alecreimel.com" },
  { label: "Bio", url: "https://bio.alecreimel.com" },
  { label: "LinkedIn", url: "https://www.linkedin.com/in/alecwreimel/" },
  { label: "GitHub", url: "https://github.com/areimel" },
];
