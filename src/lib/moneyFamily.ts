// The Money app's starter family, from the server's env so real names stay out of the repo and
// out of the browser bundle (NEXT_PUBLIC_ vars are inlined into static files the login doesn't
// cover). Served to signed-in users by /api/money/family.
//
//   MONEY_MY_NAMES="Asha Rao, Asha K Rao"            how you show up in their statements
//   MONEY_FAMILY="Ravi Rao, Ravi K Rao; Meena Rao"   people split by ";", names by ","; the first is shown

export type StarterPerson = { id: string; name: string; aliases: string[] };
export type StarterFamily = { me: string[]; family: StarterPerson[] };

const names = (list: string) =>
  list
    .split(",")
    .map((n) => n.trim().replace(/\s+/g, " "))
    .filter(Boolean);

export function parseStarterFamily(myNames = "", family = ""): StarterFamily {
  const taken = new Set<string>();
  const people: StarterPerson[] = [];
  for (const entry of family.split(";")) {
    const aliases = names(entry);
    if (!aliases.length) continue;
    // A stable id from the first name, so the same env seeds the same ids on every device.
    const base = aliases[0].split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "person";
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
    taken.add(id);
    people.push({ id, name: aliases[0], aliases });
  }
  return { me: names(myNames), family: people };
}

export const starterFamily = () => parseStarterFamily(process.env.MONEY_MY_NAMES, process.env.MONEY_FAMILY);
