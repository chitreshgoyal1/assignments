# Saverbot2 class to get next moves
class Saverbot2
  attr_reader :num, :bot_y, :bot_x, :grid

  def initialize(num, rc_xy, grid)
    @num = num
    @grid = grid
    @bot_y, @bot_x = extract_coordinates(rc_xy)
  end

  def next_move
    peach_xy = []
    grid.each_with_index do |line, index|
      if line.include?('p')
        peach_xy.push(line.chars.index('p'))
        peach_xy.push(index)
      end
    end
    printmoves(peach_xy)
  end

  private

  def printmoves(peach_xy)
    cols = peach_xy[0] - bot_x
    rows = peach_xy[1] - bot_y
    if rows != 0
      move = rows < 0 ? 'UP' : 'DOWN'
      puts move
      return
    elsif cols != 0
      move = cols < 0 ? 'LEFT' : 'RIGHT'
      puts move
    end
  end

  def extract_coordinates(rc_xy)
    rc_xy.strip.split.map(&:to_i)
  end
end
