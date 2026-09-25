import { describe, expect, it } from "vitest";
import { parseRoster } from "./learning-suite";

/**
 * These cases are the shapes real exports have arrived in. Each one used to
 * import zero students, or abort the whole file, under the exact-header
 * matching this replaced.
 */

describe("parseRoster — column names", () => {
  it("reads the Learning Suite split-name export", () => {
    const { students, error } = parseRoster(
      'Last Name,First Name,Net ID,Student ID,Email\nSmith,Jane,jsmith7,123456789,jsmith7@byu.edu\n',
    );
    expect(error).toBeUndefined();
    expect(students).toEqual([
      {
        name: "Jane Smith",
        sortName: "Smith, Jane",
        netId: "jsmith7",
        lmsStudentId: "123456789",
        email: "jsmith7@byu.edu",
      },
    ]);
  });

  it("reads spellings the old exact matcher missed", () => {
    const { students, error } = parseRoster('Name,NetID,E-mail\nJane Smith,JSmith7,JSmith7@BYU.edu\n');
    expect(error).toBeUndefined();
    expect(students[0]).toMatchObject({
      name: "Jane Smith",
      sortName: "Smith, Jane",
      netId: "jsmith7",
      email: "jsmith7@byu.edu",
    });
  });

  it("reads a decorated header", () => {
    const { students } = parseRoster(
      '"Student Name (Last, First)",BYU Net ID *\n"Smith, Jane",jsmith7\n',
    );
    expect(students[0]).toMatchObject({ name: "Jane Smith", sortName: "Smith, Jane", netId: "jsmith7" });
  });

  it("prefers an exact Last Name over a substring match on Name", () => {
    const { students } = parseRoster("Name,Last Name,First Name\nignored,Smith,Jane\n");
    expect(students[0]).toMatchObject({ name: "Jane Smith", sortName: "Smith, Jane" });
  });

  it("does not read Student ID as a Net ID", () => {
    const { students } = parseRoster("Student Name,Student ID\nJane Smith,123456789\n");
    expect(students[0]).toMatchObject({ netId: null, lmsStudentId: "123456789" });
  });

  it("refuses a file with no name column, and says what it found", () => {
    const { students, error } = parseRoster("Section,Credits,Grade\n001,3,A\n");
    expect(students).toEqual([]);
    expect(error).toContain("Section, Credits, Grade");
  });
});

describe("parseRoster — file shapes", () => {
  it("finds the header under a title and a blank line", () => {
    const { students, error } = parseRoster(
      'CSANM 494R Class Roll,,\n,,\nLast Name,First Name,Net ID\nSmith,Jane,jsmith7\n',
    );
    expect(error).toBeUndefined();
    expect(students).toHaveLength(1);
  });

  it("keeps going past a short row instead of aborting the file", () => {
    // The old parser returned a failure for the whole file here, because
    // papaparse reports a row with too few fields as an error.
    const { students, skipped, error } = parseRoster(
      "Last Name,First Name,Net ID\nSmith,Jane,jsmith7\nJones\nDoe,John,jdoe2\n",
    );
    expect(error).toBeUndefined();
    // "Jones" is a surname with nothing else on the row: still a student.
    expect(students.map((s) => s.name)).toEqual(["Jane Smith", "Jones", "John Doe"]);
    expect(skipped).toBe(0);
  });

  it("skips a row that carries no name and no identifier", () => {
    const { students, skipped } = parseRoster(
      "Last Name,First Name,Net ID\nSmith,Jane,jsmith7\n,,\x20\n",
    );
    expect(students).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("handles CRLF, quoted commas and a trailing blank line", () => {
    const { students } = parseRoster('Student Name,Email\r\n"Smith, Jane",jane@byu.edu\r\n\r\n');
    expect(students).toHaveLength(1);
    expect(students[0].name).toBe("Jane Smith");
  });

  it("handles a tab-separated file saved as .csv", () => {
    const { students, error } = parseRoster("Last Name\tFirst Name\tNet ID\nSmith\tJane\tjsmith7\n");
    expect(error).toBeUndefined();
    expect(students[0]).toMatchObject({ name: "Jane Smith", netId: "jsmith7" });
  });

  it("ignores rows that are nothing but delimiters", () => {
    const { students, skipped } = parseRoster("Student Name,Net ID\nJane Smith,jsmith7\n,,\n,\n");
    expect(students).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("ignores a header repeated mid-file", () => {
    const { students } = parseRoster(
      "Last Name,First Name\nSmith,Jane\nLast Name,First Name\nDoe,John\n",
    );
    expect(students.map((s) => s.name)).toEqual(["Jane Smith", "John Doe"]);
  });

  it("does not drop a real student whose first name happens to be a header word", () => {
    // Only "First Name" contains a header alias ("First"); "Last Name" and
    // "Net ID" don't match this row at all, so it's a minority match and
    // must be read as a student, not skipped as a repeated header.
    const { students, skipped } = parseRoster(
      "Last Name,First Name,Net ID\nSmith,Jane,jsmith7\nBaker,First,bbaker1\n",
    );
    expect(students.map((s) => s.name)).toEqual(["Jane Smith", "First Baker"]);
    expect(skipped).toBe(0);
  });

  it("still skips a header repeated mid-file even with an extra blank-ish column", () => {
    const { students } = parseRoster(
      "Last Name,First Name,Net ID\nSmith,Jane,jsmith7\nLast Name,First Name,\nDoe,John,jdoe2\n",
    );
    expect(students.map((s) => s.name)).toEqual(["Jane Smith", "John Doe"]);
  });

  it("reports an empty file rather than throwing", () => {
    expect(parseRoster("").error).toBeTruthy();
    expect(parseRoster("\n\n").error).toBeTruthy();
  });
});

describe("parseRoster — identity", () => {
  it("derives a Net ID from a BYU address when there is no Net ID column", () => {
    const { students } = parseRoster("Student Name,Email\nJane Smith,jsmith7@byu.edu\n");
    expect(students[0].netId).toBe("jsmith7");
  });

  it("leaves a non-BYU address alone", () => {
    const { students } = parseRoster("Student Name,Email\nJane Smith,jane@gmail.com\n");
    expect(students[0].netId).toBeNull();
  });

  it("normalizes a Net ID written as an address or with capitals", () => {
    const { students } = parseRoster("Student Name,Net ID\nJane Smith,JSmith7@byu.edu\n");
    expect(students[0].netId).toBe("jsmith7");
  });

  it("collapses a student listed twice", () => {
    const { students, duplicates } = parseRoster(
      "Student Name,Net ID\nJane Smith,jsmith7\nJane Smith,JSMITH7\n",
    );
    expect(students).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it("keeps two different students who share a name when there's no Net ID column, and warns instead of merging them", () => {
    const { students, duplicates, warnings } = parseRoster(
      "Student Name\nJohn Smith\nJohn Smith\n",
    );
    // Both kept — there's no identifier to tell "same person twice" from
    // "two different Johns Smith", so dropping the second would risk
    // silently losing a real student.
    expect(students).toHaveLength(2);
    expect(duplicates).toBe(0);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Smith, John/);
  });

  it("does not warn about a same-named student when a Net ID tells them apart", () => {
    const { students, warnings } = parseRoster(
      "Student Name,Net ID\nJohn Smith,jsmith1\nJohn Smith,jsmith2\n",
    );
    expect(students).toHaveLength(2);
    expect(warnings).toEqual([]);
  });
});

describe("parseRoster — names", () => {
  it.each([
    ["Jane Smith", "Jane Smith", "Smith, Jane"],
    ["Smith, Jane", "Jane Smith", "Smith, Jane"],
    ["Jane Marie Smith", "Jane Marie Smith", "Smith, Jane Marie"],
    ["Robert Downey Jr.", "Robert Downey Jr.", "Downey Jr., Robert"],
    ["Cher", "Cher", "Cher"],
    ["  Jane   Smith  ", "Jane Smith", "Smith, Jane"],
  ])("splits %j", (input, name, sortName) => {
    const { students } = parseRoster(`Student Name\n"${input}"\n`);
    expect(students[0]).toMatchObject({ name, sortName });
  });
});
