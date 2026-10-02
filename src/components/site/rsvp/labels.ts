import type { Translator } from "@/i18n/translator";

/**
 * Hotové texty formuláře RSVP. Klientská komponenta je dostane ze serveru, aby se do prohlížeče
 * nenačítaly všechny překlady. Šablony s dosazovanými hodnotami nesou zástupné `{n}`, `{name}`,
 * `{event}`, `{person}`, `{when}`, `{date}`, které doplní `fill`.
 */
export interface RsvpLabels {
  closesAt: string;
  name: {
    label: string;
    hint: string;
    privacy: string;
    submit: string;
    searching: string;
    errors: { required: string; notFound: string; generic: string; expired: string };
  };
  unlisted: {
    prompt: string;
    button: string;
    intro: string;
    noEdit: string;
    you: string;
    personName: string;
    person: string;
    addPerson: string;
    removePerson: string;
  };
  form: {
    introListed: string;
    introEdit: string;
    notYou: string;
    otherName: string;
    required: string;
    childSuffix: string;
    attends: string;
    declines: string;
    allYes: string;
    allNo: string;
    allLabel: string;
    eventLegend: string;
    eventWhen: string;
    household: string;
  };
  plus: { toggle: string; heading: string; name: string; nameHint: string };
  child: { add: string; heading: string; name: string; age: string; remove: string };
  health: { legend: string; notice: string; diet: string; dietHint: string; allergies: string };
  questions: {
    lodging: { legend: string; need: string; own: string; unsure: string };
    transport: { legend: string; need: string; own: string; offer: string };
    song: { label: string; hint: string };
    yes: string;
    no: string;
    required: string;
    noHealthDietOn: string;
    noHealthDietOff: string;
  };
  email: { label: string; hint: string };
  submit: { send: string; save: string; sending: string };
  errors: {
    summary: string;
    attendance: string;
    required: string;
    name: string;
    age: string;
    email: string;
    tooLong: string;
    choice: string;
    invalid: string;
    limited: string;
    failed: string;
    generic: string;
    closed: string;
    expired: string;
  };
  done: {
    title: string;
    email: string;
    edit: string;
    summary: string;
    attending: string;
    declining: string;
  };
  honeypot: string;
}

/** Doplní zástupné `{klíč}` v šabloně. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function rsvpLabels(t: Translator): RsvpLabels {
  return {
    closesAt: t("rsvp.closesAt", { date: "{date}" }),
    name: {
      label: t("rsvp.name.label"),
      hint: t("rsvp.name.hint"),
      privacy: t("rsvp.name.privacy"),
      submit: t("rsvp.name.submit"),
      searching: t("rsvp.name.searching"),
      errors: {
        required: t("rsvp.name.error.required"),
        notFound: t("rsvp.name.error.notFound"),
        generic: t("rsvp.name.error.generic"),
        expired: t("rsvp.name.error.expired"),
      },
    },
    unlisted: {
      prompt: t("rsvp.unlisted.prompt"),
      button: t("rsvp.unlisted.button"),
      intro: t("rsvp.unlisted.intro"),
      noEdit: t("rsvp.unlisted.noEdit"),
      you: t("rsvp.unlisted.you"),
      personName: t("rsvp.unlisted.personName"),
      person: t("rsvp.unlisted.person", { n: "{n}" }),
      addPerson: t("rsvp.unlisted.addPerson"),
      removePerson: t("rsvp.unlisted.removePerson", { n: "{n}" }),
    },
    form: {
      introListed: t("rsvp.form.introListed"),
      introEdit: t("rsvp.form.introEdit"),
      notYou: t("rsvp.form.notYou"),
      otherName: t("rsvp.form.otherName"),
      required: t("rsvp.form.required"),
      childSuffix: t("rsvp.form.childSuffix", { name: "{name}" }),
      attends: t("rsvp.form.attends"),
      declines: t("rsvp.form.declines"),
      allYes: t("rsvp.form.allYes"),
      allNo: t("rsvp.form.allNo"),
      allLabel: t("rsvp.form.allLabel", { event: "{event}" }),
      eventLegend: t("rsvp.form.eventLegend", { person: "{person}", event: "{event}" }),
      eventWhen: t("rsvp.form.eventWhen", { when: "{when}" }),
      household: t("rsvp.form.household"),
    },
    plus: {
      toggle: t("rsvp.plus.toggle"),
      heading: t("rsvp.plus.heading"),
      name: t("rsvp.plus.name"),
      nameHint: t("rsvp.plus.nameHint"),
    },
    child: {
      add: t("rsvp.child.add"),
      heading: t("rsvp.child.heading", { n: "{n}" }),
      name: t("rsvp.child.name"),
      age: t("rsvp.child.age"),
      remove: t("rsvp.child.remove", { n: "{n}" }),
    },
    health: {
      legend: t("rsvp.health.legend", { name: "{name}" }),
      notice: t("rsvp.health.notice"),
      diet: t("rsvp.health.diet"),
      dietHint: t("rsvp.health.dietHint"),
      allergies: t("rsvp.health.allergies"),
    },
    questions: {
      lodging: {
        legend: t("rsvp.questions.lodging.legend"),
        need: t("rsvp.questions.lodging.need"),
        own: t("rsvp.questions.lodging.own"),
        unsure: t("rsvp.questions.lodging.unsure"),
      },
      transport: {
        legend: t("rsvp.questions.transport.legend"),
        need: t("rsvp.questions.transport.need"),
        own: t("rsvp.questions.transport.own"),
        offer: t("rsvp.questions.transport.offer"),
      },
      song: { label: t("rsvp.questions.song.label"), hint: t("rsvp.questions.song.hint") },
      yes: t("rsvp.questions.yes"),
      no: t("rsvp.questions.no"),
      required: t("rsvp.questions.required"),
      noHealthDietOn: t("rsvp.questions.noHealthDietOn"),
      noHealthDietOff: t("rsvp.questions.noHealthDietOff"),
    },
    email: { label: t("rsvp.email.label"), hint: t("rsvp.email.hint") },
    submit: {
      send: t("rsvp.submit.send"),
      save: t("rsvp.submit.save"),
      sending: t("rsvp.submit.sending"),
    },
    errors: {
      summary: t("rsvp.errors.summary"),
      attendance: t("rsvp.errors.attendance"),
      required: t("rsvp.errors.required"),
      name: t("rsvp.errors.name"),
      age: t("rsvp.errors.age"),
      email: t("rsvp.errors.email"),
      tooLong: t("rsvp.errors.tooLong"),
      choice: t("rsvp.errors.choice"),
      invalid: t("rsvp.errors.invalid"),
      limited: t("rsvp.errors.limited"),
      failed: t("rsvp.errors.failed"),
      generic: t("rsvp.errors.generic"),
      closed: t("rsvp.errors.closed"),
      expired: t("rsvp.name.error.expired"),
    },
    done: {
      title: t("rsvp.done.title"),
      email: t("rsvp.done.email"),
      edit: t("rsvp.done.edit"),
      summary: t("rsvp.done.summary"),
      attending: t("rsvp.done.attending"),
      declining: t("rsvp.done.declining"),
    },
    honeypot: t("rsvp.honeypot.label"),
  };
}
