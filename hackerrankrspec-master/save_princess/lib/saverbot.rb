# Saverbot class to get moves
class Saverbot
  attr_reader :num, :grid

  def initialize(num, grid)
    @num = num
    @grid = grid
  end

  def display_path_to_princess
    peach_xy      = []
    saverbot_xy   = []
    grid.each_with_index do |line, index|
      if line.include?('p')
        peach_xy.push(line.chars.index('p'))
        peach_xy.push(index)
      end
    end
    2.times { saverbot_xy.push((num - 1) / 2) }
    getmoves(peach_xy, saverbot_xy)
  end

  private

  def getmoves(peach_xy, saverbot_xy)
    cols = peach_xy[0] - saverbot_xy[0]
    rows = peach_xy[1] - saverbot_xy[1]
    row_cols(rows, cols).each { |move| puts move }
  end

  def row_cols(rows, cols)
    moves = []
    moves.push(rows < 0 ? "UP\n" * rows.abs : "DOWN\n" * rows)
    moves.push(cols < 0 ? "LEFT\n" * cols.abs : "RIGHT\n" * cols)
  end
end
