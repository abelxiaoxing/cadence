/** Correlates view work, never cancels an accepted command. */
export class ViewLifetime {
  private generation = 0;
  private identity = "";
  select(identity: string): void {
    if (identity !== this.identity) {
      this.identity = identity;
      this.depart();
    }
  }
  depart(): void {
    this.generation++;
  }
  ticket(): number {
    return this.generation;
  }
  current(ticket: number): boolean {
    return ticket === this.generation;
  }
}
