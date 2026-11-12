"use client";

import { Table } from "@heroui/react";
import type { ReactNode } from "react";

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode };

/**
 * A HeroUI table for rows that are read, not edited. The first column is the row header, which is what a
 * screen reader announces for each cell. An empty list shows its own sentence instead of a header with no rows.
 */
export default function DataTable<T>({
  label,
  columns,
  rows,
  rowId,
  empty,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowId: (row: T, index: number) => string;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {empty}
      </p>
    );
  }
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            {columns.map((column, index) => (
              <Table.Column key={column.key} id={column.key} isRowHeader={index === 0}>
                {column.header}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {rows.map((row, index) => {
              const id = rowId(row, index);
              return (
                <Table.Row key={id} id={id}>
                  {columns.map((column) => (
                    <Table.Cell key={column.key}>{column.cell(row)}</Table.Cell>
                  ))}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
