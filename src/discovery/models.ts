export function isAppleModel(model?: string): boolean {
  if (!model) return false;
  return /^(MacBook|Macmini|iMac|MacPro|Mac|iPhone|iPad|iPod|AppleTV|Apple TV|AudioAccessory|HomePod|Watch|Vision)/i.test(
    model.trim(),
  );
}

export function isAndroidModel(model?: string): boolean {
  return !!model && /android|google|chromecast|\bsm-[a-z]\d{3,}[a-z0-9-]*\b|\bxt\d{4}\b/i.test(model);
}

export function isVirtualInfrastructure(device: {
  name?: string;
  model?: string;
  vendor?: string;
}): boolean {
  const identity = `${device.name ?? ""} ${device.model ?? ""} ${device.vendor ?? ""}`;
  return /(?:^|[\s._-])(?:docker(?:-desktop)?|podman|containerd|virtualbox|vmware|hyper-v|wsl|virbr\d*|veth[0-9a-f]*|br-[0-9a-f]{6,})(?:$|[\s._-])|\.docker\.internal\b|\.containers\.internal\b/i.test(identity);
}

export function specificDeviceType(device: {
  kind: string;
  name?: string;
  model?: string;
  vendor?: string;
  hints?: ReadonlySet<string>;
}): string | undefined {
  const { kind, name = "", model = "", vendor = "", hints } = device;
  const modelText = model.trim();
  const text = `${vendor} ${modelText} ${name}`.toLowerCase();
  const hasHint = (hint: string) => hints?.has(hint) ?? false;

  if (kind === "router") {
    const brand = knownBrand(text);
    return brand ? `${brand} roteador` : "Roteador";
  }

  if (kind === "apple" || hasHint("apple")) {
    if (/^(iphone|iphone\d)/i.test(modelText)) return "Apple iPhone";
    if (/^(macbook)/i.test(modelText)) return "Apple MacBook";
    if (/^(macmini)/i.test(modelText)) return "Apple Mac mini";
    if (/^(imac)/i.test(modelText)) return "Apple iMac";
    if (/^(macpro|macstudio|mac\d)/i.test(modelText)) return "Apple Mac";
    if (/^(appletv|apple tv)/i.test(modelText)) return "Apple TV";
    if (/^ipad/i.test(modelText)) return "Apple iPad";
    if (/^(ipod|homepod|audioaccessory|watch|vision)/i.test(modelText)) return "Apple device";

    if (/\biphone\b/.test(text)) return "Apple iPhone";
    if (/\b(macbook|imac|mac mini|mac studio|mac pro)\b/.test(text)) return "Apple Mac";
    if (/\b(appletv|apple tv)\b/.test(text)) return "Apple TV";
    return "Apple device";
  }

  if (kind === "android-tv" || hasHint("android-tv")) {
    const brand = knownBrand(text);
    if (brand) return /box|shield|stick|chromecast/i.test(text)
      ? `${brand} TV Box`
      : `${brand} Android TV`;
    return /box|shield|stick/i.test(text) ? "Android TV Box" : "Android TV";
  }

  const phoneModel = /\bsm-[a-z]\d{3,}[a-z0-9-]*\b|\bxt\d{4}\b|\bmoto\s/i.test(text);
  if (kind === "android" || hasHint("android") || phoneModel) {
    if (/\b(samsung|galaxy|sm-[a-z]\d)/i.test(text)) return "Samsung Android";
    if (/\b(motorola|moto\s|xt\d{4})/i.test(text)) return "Motorola Android";
    if (/\b(xiaomi|redmi|poco)\b/i.test(text)) return "Xiaomi Android";
    if (/\b(pixel|google)\b/i.test(text)) return "Google Android";
    return "Android";
  }

  if (hasHint("linux-workstation")) {
    if (/\b(linux|ubuntu|debian|fedora|arch)\b/i.test(text)) {
      return /\b(notebook|laptop|thinkpad|framework)\b/i.test(text) ? "Notebook Linux" : "Computador Linux";
    }
    if (/\b(notebook|laptop|thinkpad|framework)\b/i.test(text)) return "Notebook (mDNS)";
    return "Computador (mDNS)";
  }

  if (/\b(linux|ubuntu|debian|fedora|arch)\b/i.test(text) && /\b(notebook|laptop|thinkpad)\b/i.test(text)) {
    return "Notebook Linux";
  }

  return undefined;
}

function knownBrand(text: string): string | undefined {
  const brands: Array<[RegExp, string]> = [
    [/\b(samsung|galaxy)\b/i, "Samsung"],
    [/\b(motorola|moto)\b/i, "Motorola"],
    [/\b(xiaomi|redmi|poco|mi box)\b/i, "Xiaomi"],
    [/\b(oneplus)\b/i, "OnePlus"],
    [/\b(tcl)\b/i, "TCL"],
    [/\b(sony|bravia)\b/i, "Sony"],
    [/\b(philips)\b/i, "Philips"],
    [/\b(hisense)\b/i, "Hisense"],
    [/\b(skyworth)\b/i, "Skyworth"],
    [/\b(panasonic)\b/i, "Panasonic"],
    [/\b(sharp)\b/i, "Sharp"],
    [/\b(toshiba)\b/i, "Toshiba"],
    [/\b(nvidia|shield)\b/i, "NVIDIA"],
    [/\b(amazon|fire tv)\b/i, "Amazon"],
    [/\b(lg|webos)\b/i, "LG"],
    [/\b(google|chromecast)\b/i, "Google"],
  ];
  return brands.find(([pattern]) => pattern.test(text))?.[1];
}
