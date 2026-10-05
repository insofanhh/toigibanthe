export function createChefMapPin(
  name: string,
  avatar: string | null | undefined,
  tagName: "button" | "div" = "div",
) {
  const element = document.createElement(tagName);
  element.className = "chef-map-pin";
  if (tagName === "button") (element as HTMLButtonElement).type = "button";

  const avatarElement = document.createElement("span");
  avatarElement.className = "chef-map-pin-avatar";
  avatarElement.textContent = name.trim().charAt(0).toUpperCase() || "B";
  if (avatar) {
    const image = document.createElement("img");
    image.src = avatar;
    image.alt = "";
    image.addEventListener("error", () => image.remove(), { once: true });
    avatarElement.appendChild(image);
  }

  const label = document.createElement("span");
  label.className = "chef-map-pin-label";
  label.textContent = name;
  element.append(avatarElement, label);
  return element;
}
